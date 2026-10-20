"""Dev-only tuning of the GRU comparison model (never touches test patients).

The first GRU stopped after 3-6 epochs, suggesting it overfits patient-level
context. This compares a few defensible variants with the same 5-fold
patient-grouped CV used for every other model and writes results/gru_tuning.json.
"""

import json
import sys

import numpy as np

sys.path.insert(0, ".")
from pratirup.config import HORIZONS_MIN, RESULTS_DIR  # noqa: E402
from pratirup.evaluation.benchmark import load_split, load_tables  # noqa: E402
from pratirup.features import (  # noqa: E402
    EVENT_FEATURES, PROFILE_FEATURES, STATIC_FEATURES, TIME_FEATURES, build_dataset, series_by_recording,
)
from pratirup.models import seq as gru  # noqa: E402
from pratirup.models.bundle import ModelBundle  # noqa: E402

VARIANTS = {
    "context_all_lr1e-3_h64": dict(ctx=TIME_FEATURES + EVENT_FEATURES + PROFILE_FEATURES + STATIC_FEATURES, lr=1e-3, hidden=64),
    "context_no_ehr_lr1e-3_h64": dict(ctx=TIME_FEATURES + EVENT_FEATURES + PROFILE_FEATURES, lr=1e-3, hidden=64),
    "context_all_lr3e-4_h64": dict(ctx=TIME_FEATURES + EVENT_FEATURES + PROFILE_FEATURES + STATIC_FEATURES, lr=3e-4, hidden=64),
    "context_no_ehr_lr3e-4_h128": dict(ctx=TIME_FEATURES + EVENT_FEATURES + PROFILE_FEATURES, lr=3e-4, hidden=128),
}


def main():
    tables = load_tables()
    split = load_split()
    recs = tables["recordings"]
    dev = recs[~recs["patient_id"].isin(split["test_patients"])]
    kp = ModelBundle.load().kalman
    series = series_by_recording(dev, tables["cgm"], tables["events"])
    data = build_dataset(dev, tables["cgm"], tables["events"], kp)
    data = data[data["issuable"]].reset_index(drop=True)
    data["fold"] = data["patient_id"].map(split["dev_folds"]).astype(int)
    rows_any = np.logical_or.reduce([np.isfinite(data[f"dy_{h}"].to_numpy()) for h in HORIZONS_MIN])
    d = data[rows_any].reset_index(drop=True)
    out = {}
    for name, cfg in VARIANTS.items():
        oof, epochs = gru.cross_validate(series, d, context=cfg["ctx"], lr=cfg["lr"], hidden=cfg["hidden"])
        maes = {}
        for i, h in enumerate(HORIZONS_MIN):
            m = np.isfinite(d[f"dy_{h}"].to_numpy())
            maes[h] = float(np.mean(np.abs(oof[m, i] - d.loc[m, f"dy_{h}"].to_numpy())))
        out[name] = {"mae": maes, "mean_mae": float(np.mean(list(maes.values()))), "epochs": epochs,
                     "lr": cfg["lr"], "hidden": cfg["hidden"], "uses_ehr": cfg["ctx"][-1] in STATIC_FEATURES}
        print(name, out[name], flush=True)
    best = min(out, key=lambda k: out[k]["mean_mae"])
    (RESULTS_DIR / "gru_tuning.json").write_text(json.dumps({"variants": out, "selected": best}, indent=2))
    print("selected", best)


if __name__ == "__main__":
    main()
