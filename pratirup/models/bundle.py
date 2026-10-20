"""The trained model bundle used by both offline evaluation and the live twin.

One bundle = Kalman parameters + per-horizon point and quantile forecasters +
conformal adjustments + personalisation parameters + calibrated event
classifiers + alert thresholds. Everything is written to `models/` as plain
LightGBM text files and one JSON manifest, so a reviewer can inspect it.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path

import lightgbm as lgb
import numpy as np
import pandas as pd

from pratirup.config import HORIZONS_MIN, MODELS_DIR
from pratirup.twin.kalman import KalmanParams

EVENT_KINDS = ("hyper", "hyper2", "hypo")


@dataclass
class Isotonic:
    x: list[float]
    y: list[float]

    def __call__(self, p: np.ndarray) -> np.ndarray:
        return np.interp(p, self.x, self.y, left=self.y[0], right=self.y[-1])


@dataclass
class ModelBundle:
    kalman: KalmanParams
    features: list[str]
    point: dict[int, lgb.Booster]
    q_lo: dict[int, lgb.Booster]
    q_hi: dict[int, lgb.Booster]
    conformal_q: dict[int, float]
    personal: dict[int, dict]                 # {"lambda": float, "halflife": float}
    classifiers: dict[str, lgb.Booster] = field(default_factory=dict)
    calibrators: dict[str, Isotonic] = field(default_factory=dict)
    thresholds: dict[str, float] = field(default_factory=dict)
    meta: dict = field(default_factory=dict)

    # -- inference ------------------------------------------------------
    def predict(self, X: pd.DataFrame) -> dict[str, np.ndarray]:
        """Population-level outputs (no personal correction). Values in mg/dL."""
        Xf = X[self.features]
        g0 = X["g0"].to_numpy()
        out: dict[str, np.ndarray] = {}
        for h in HORIZONS_MIN:
            out[f"yhat_{h}"] = g0 + self.point[h].predict(Xf)
            lo = g0 + self.q_lo[h].predict(Xf) - self.conformal_q[h]
            hi = g0 + self.q_hi[h].predict(Xf) + self.conformal_q[h]
            out[f"lo_{h}"] = np.minimum(lo, out[f"yhat_{h}"])
            out[f"hi_{h}"] = np.maximum(hi, out[f"yhat_{h}"])
        for kind, clf in self.classifiers.items():
            out[f"p_{kind}"] = self.calibrators[kind](clf.predict(Xf))
        return out

    def contributions(self, X: pd.DataFrame, horizon: int) -> pd.DataFrame:
        """Per-feature additive contributions (TreeSHAP) to the point forecast."""
        c = self.point[horizon].predict(X[self.features], pred_contrib=True)
        return pd.DataFrame(c, columns=self.features + ["bias"], index=X.index)

    def event_contributions(self, X: pd.DataFrame, kind: str) -> pd.DataFrame:
        c = self.classifiers[kind].predict(X[self.features], pred_contrib=True)
        return pd.DataFrame(c, columns=self.features + ["bias"], index=X.index)

    # -- persistence ----------------------------------------------------
    def save(self, root: Path = MODELS_DIR) -> None:
        root.mkdir(parents=True, exist_ok=True)
        for h in HORIZONS_MIN:
            self.point[h].save_model(str(root / f"forecast_{h}min.txt"))
            self.q_lo[h].save_model(str(root / f"quantile_lo_{h}min.txt"))
            self.q_hi[h].save_model(str(root / f"quantile_hi_{h}min.txt"))
        for kind, clf in self.classifiers.items():
            clf.save_model(str(root / f"event_{kind}.txt"))
        manifest = {
            "kalman": self.kalman.to_dict(),
            "features": self.features,
            "conformal_q": {str(k): v for k, v in self.conformal_q.items()},
            "personal": {str(k): v for k, v in self.personal.items()},
            "calibrators": {k: {"x": v.x, "y": v.y} for k, v in self.calibrators.items()},
            "thresholds": self.thresholds,
            "event_kinds": list(self.classifiers),
            "meta": self.meta,
        }
        (root / "bundle.json").write_text(json.dumps(manifest, indent=2))

    @classmethod
    def load(cls, root: Path = MODELS_DIR) -> "ModelBundle":
        m = json.loads((root / "bundle.json").read_text())
        hs = HORIZONS_MIN
        return cls(
            kalman=KalmanParams(**m["kalman"]),
            features=m["features"],
            point={h: lgb.Booster(model_file=str(root / f"forecast_{h}min.txt")) for h in hs},
            q_lo={h: lgb.Booster(model_file=str(root / f"quantile_lo_{h}min.txt")) for h in hs},
            q_hi={h: lgb.Booster(model_file=str(root / f"quantile_hi_{h}min.txt")) for h in hs},
            conformal_q={int(k): v for k, v in m["conformal_q"].items()},
            personal={int(k): v for k, v in m["personal"].items()},
            classifiers={k: lgb.Booster(model_file=str(root / f"event_{k}.txt")) for k in m["event_kinds"]},
            calibrators={k: Isotonic(**v) for k, v in m["calibrators"].items()},
            thresholds=m["thresholds"],
            meta=m["meta"],
        )


def personal_bias(df: pd.DataFrame, resid_col: str, h_slots: int, halflife: float) -> np.ndarray:
    """Online residual correction, computed causally per recording.

    The residual of a forecast issued at slot s is only known at s + h. The bias
    applied at slot s is an exponentially weighted mean of residuals whose
    outcomes were observed at or before s.
    """
    out = np.zeros(len(df))
    for _, idx in df.groupby("recording_id", sort=False).indices.items():
        sub = df.iloc[idx]
        slots = sub["slot"].to_numpy()
        n = int(slots.max()) + 1
        r = np.full(n, np.nan)
        r[slots] = sub[resid_col].to_numpy()
        ew = pd.Series(r).ewm(halflife=halflife, ignore_na=True, min_periods=1).mean()
        known = ew.shift(h_slots).to_numpy()   # residuals resolved by time s
        out[idx] = np.nan_to_num(known[slots], nan=0.0)
    return out
