"""Zero-shot time-series foundation model baseline: Amazon Chronos-Bolt (small).

No training and no tuning: the pretrained model sees the last 24 h of CGM
readings for each forecast and predicts the next 2 h. It is scored on the same
issue times and targets as Pratirup, on development and test patients.
Because nothing is fitted or selected, scoring the test patients does not
leak information into any modelling choice.

Model: amazon/chronos-bolt-small (48M parameters, Apache-2.0).
Install: pip install chronos-forecasting  (benchmark only; not in the app image)
"""

from __future__ import annotations

import json
import sys
import time

import numpy as np
import pandas as pd
import torch

sys.path.insert(0, ".")
from pratirup.config import HORIZONS_MIN, RESULTS_DIR, horizon_slots  # noqa: E402
from pratirup.evaluation.benchmark import load_split, load_tables  # noqa: E402
from pratirup.features import build_dataset, series_by_recording  # noqa: E402
from pratirup.models.bundle import ModelBundle  # noqa: E402

MODEL_ID = "amazon/chronos-bolt-small"
CONTEXT = 96          # 24 h of 15-min readings
BATCH = 512


def windows(series, rows: pd.DataFrame) -> torch.Tensor:
    out = np.full((len(rows), CONTEXT), np.nan, dtype=np.float32)
    for rid, idx in rows.groupby("recording_id", sort=False).indices.items():
        g = pd.Series(series[rid].glucose).ffill().to_numpy()   # carry last value across gaps
        pad = np.concatenate([np.full(CONTEXT - 1, np.nan), g])
        for j, s in zip(idx, rows["slot"].to_numpy()[idx]):
            out[j] = pad[s : s + CONTEXT]
    return torch.from_numpy(out)


def evaluate(pipe, series, data: pd.DataFrame, label: str) -> dict:
    ctx = windows(series, data)
    hmax = horizon_slots(max(HORIZONS_MIN))
    q_all = []
    t0 = time.time()
    for i in range(0, len(ctx), BATCH):
        q, _ = pipe.predict_quantiles(ctx[i : i + BATCH], prediction_length=hmax, quantile_levels=[0.1, 0.5, 0.9])
        q_all.append(q.numpy())
    q = np.concatenate(q_all)
    res = {"n_forecasts": int(len(data)), "seconds": round(time.time() - t0, 1)}
    for h in HORIZONS_MIN:
        k = horizon_slots(h) - 1
        m = np.isfinite(data[f"y_{h}"].to_numpy())
        y = data.loc[m, f"y_{h}"].to_numpy()
        med, lo, hi = q[m, k, 1], q[m, k, 0], q[m, k, 2]
        g0 = data.loc[m, "g0"].to_numpy()
        res[str(h)] = {
            "mae": float(np.mean(np.abs(med - y))), "rmse": float(np.sqrt(np.mean((med - y) ** 2))),
            "mae_persistence": float(np.mean(np.abs(g0 - y))),
            "coverage_80": float(np.mean((y >= lo) & (y <= hi))), "mean_width_80": float(np.mean(hi - lo)),
        }
    print(label, json.dumps(res), flush=True)
    return res


def main() -> None:
    from chronos import BaseChronosPipeline
    torch.set_num_threads(16)
    pipe = BaseChronosPipeline.from_pretrained(MODEL_ID, device_map="cpu", torch_dtype=torch.float32)
    tables = load_tables()
    split = load_split()
    recs = tables["recordings"]
    kp = ModelBundle.load().kalman
    out = {"model": MODEL_ID, "context_slots": CONTEXT, "protocol": "zero-shot, no fitting, same issue times as Pratirup"}
    for name, sel in (("test", recs["patient_id"].isin(split["test_patients"])),
                      ("dev", ~recs["patient_id"].isin(split["test_patients"]))):
        r = recs[sel]
        series = series_by_recording(r, tables["cgm"], tables["events"])
        data = build_dataset(r, tables["cgm"], tables["events"], kp)
        data = data[data["issuable"]].reset_index(drop=True)
        out[name] = evaluate(pipe, series, data, name)
    (RESULTS_DIR / "experiments").mkdir(parents=True, exist_ok=True)
    (RESULTS_DIR / "experiments" / "foundation_model_zero_shot.json").write_text(json.dumps(out, indent=2))


if __name__ == "__main__":
    main()
