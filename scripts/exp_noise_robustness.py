"""Dev-only experiment: can noise-augmented training fix sensitivity to sensor noise?

The v1 test evaluation showed that adding independent noise (SD 10 mg/dL) to
every reading made the 30-min forecast worse than persistence. This experiment
uses ONLY the 80 development patients (5-fold patient-grouped CV) to compare:

  v1     : trained on clean inputs (current model)
  v2     : trained on clean + noise-augmented copies, plus a roughness feature
           (SD of second differences over the last 3 h) so the model can tell
           how noisy the recent signal is

Each is scored on held-out folds with clean inputs and with noisy inputs
(SD 5, 10, 20). Targets are always the true, unperturbed future readings.

Decision rule, fixed before running: adopt v2 if clean 60-min MAE worsens by
<= 2% AND noisy (SD 10) 30-min MAE improves by >= 20% and beats persistence.
"""

from __future__ import annotations

import copy
import json
import sys

import numpy as np
import pandas as pd

sys.path.insert(0, ".")
from pratirup.config import HORIZONS_MIN, RESULTS_DIR, SEED  # noqa: E402
from pratirup.evaluation.benchmark import load_split, load_tables  # noqa: E402
from pratirup.features import FEATURE_SETS, build_features, build_targets, series_by_recording  # noqa: E402
from pratirup.models import lgbm  # noqa: E402
from pratirup.models.bundle import ModelBundle  # noqa: E402

TRAIN_NOISE_SD = (5.0, 10.0, 15.0)
EVAL_NOISE_SD = (0.0, 5.0, 10.0, 20.0)


def noisy(s, sd: float, rng: np.random.Generator):
    if sd == 0:
        return s
    t = copy.deepcopy(s)
    m = np.isfinite(t.glucose)
    t.glucose[m] = np.clip(t.glucose[m] + rng.normal(0, sd, m.sum()), 40, 500)
    return t


def frame(series: dict, sd_of, kp, rng) -> pd.DataFrame:
    parts = []
    for rid, s in series.items():
        sd = sd_of(rid)
        f = build_features(noisy(s, sd, rng), kp)
        t = build_targets(s)                      # truth from the clean series
        f = pd.concat([f, t], axis=1)
        f["noise_sd"] = sd
        parts.append(f)
    d = pd.concat(parts, ignore_index=True)
    return d


def main() -> None:
    tables = load_tables()
    split = load_split()
    recs = tables["recordings"]
    dev = recs[~recs["patient_id"].isin(split["test_patients"])]
    bundle = ModelBundle.load()
    kp = bundle.kalman
    params = {k: v for k, v in bundle.meta["lgbm_params"].items()
              if k in ("num_leaves", "min_data_in_leaf", "feature_fraction", "lambda_l2")}
    feats = FEATURE_SETS["full"]
    feats_v2 = feats + ["roughness_3h"]
    series = series_by_recording(dev, tables["cgm"], tables["events"])
    fold_of = split["dev_folds"]

    rng = np.random.default_rng(SEED)
    clean = frame(series, lambda r: 0.0, kp, rng)
    aug_sd = {rid: float(rng.choice(TRAIN_NOISE_SD)) for rid in series}
    aug = frame(series, lambda r: aug_sd[r], kp, rng)
    evals = {sd: frame(series, lambda r, sd=sd: sd, kp, np.random.default_rng(SEED + int(sd))) for sd in EVAL_NOISE_SD}

    def prep(d):
        d = d[d["issuable"]].copy()
        d["fold"] = d["patient_id"].map(fold_of).astype(int)
        return d.reset_index(drop=True)

    clean, aug = prep(clean), prep(aug)
    evals = {k: prep(v) for k, v in evals.items()}
    out = {"train_noise_sd": TRAIN_NOISE_SD, "eval_noise_sd": EVAL_NOISE_SD, "results": {}}
    for h in HORIZONS_MIN:
        y = f"dy_{h}"
        res = {}
        for name, train_sets, fs in (("v1_clean_training", [clean], feats), ("v2_noise_augmented", [clean, aug], feats_v2)):
            tr_all = pd.concat(train_sets, ignore_index=True)
            tr_all = tr_all[np.isfinite(tr_all[y].to_numpy())]
            n_iter = int(bundle.meta["n_iter"]["full"][str(h)])
            for k in range(5):
                tr = tr_all[tr_all["fold"] != k]
                model = lgbm.fit(tr[fs], tr[y].to_numpy(), params, n_iter)
                for sd, ev in evals.items():
                    te = ev[(ev["fold"] == k) & np.isfinite(ev[y].to_numpy())]
                    pred = te["g0"].to_numpy() + model.predict(te[fs])
                    key = (name, sd)
                    acc = res.setdefault(key, {"abs": [], "abs_persist": []})
                    true = te[f"y_{h}"].to_numpy()
                    acc["abs"].append(np.abs(pred - true))
                    acc["abs_persist"].append(np.abs(te["g0"].to_numpy() - true))
        out["results"][str(h)] = {
            f"{name}|sd={sd:g}": {"mae": float(np.mean(np.concatenate(v["abs"]))),
                                   "mae_persistence": float(np.mean(np.concatenate(v["abs_persist"])))}
            for (name, sd), v in res.items()
        }
        print(h, json.dumps(out["results"][str(h)], indent=1), flush=True)

    r30, r60 = out["results"]["30"], out["results"]["60"]
    clean_worse = r60["v2_noise_augmented|sd=0"]["mae"] / r60["v1_clean_training|sd=0"]["mae"] - 1
    noisy_gain = 1 - r30["v2_noise_augmented|sd=10"]["mae"] / r30["v1_clean_training|sd=10"]["mae"]
    beats = r30["v2_noise_augmented|sd=10"]["mae"] < r30["v2_noise_augmented|sd=10"]["mae_persistence"]
    out["decision"] = {
        "clean_60_relative_change": clean_worse, "noisy10_30_relative_gain": noisy_gain,
        "noisy10_30_beats_persistence": bool(beats),
        "adopt_v2": bool(clean_worse <= 0.02 and noisy_gain >= 0.20 and beats),
        "rule": "adopt if clean 60-min MAE worsens <= 2% and noisy(SD 10) 30-min MAE improves >= 20% and beats persistence",
    }
    (RESULTS_DIR / "experiments").mkdir(parents=True, exist_ok=True)
    (RESULTS_DIR / "experiments" / "noise_robustness_dev.json").write_text(json.dumps(out, indent=2))
    print(json.dumps(out["decision"], indent=1))


if __name__ == "__main__":
    main()
