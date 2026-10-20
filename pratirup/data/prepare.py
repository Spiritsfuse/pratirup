"""Build processed tables and the patient-level evaluation split.

The split is created once with a fixed seed and committed. It is
stratified by insulin use so both arms of the test set include insulin-treated
and non-insulin patients. Patients (not recordings) are the unit of splitting:
the two recordings of one person always land in the same partition.
"""

from __future__ import annotations

import hashlib
import json

import numpy as np
import pandas as pd
from sklearn.model_selection import StratifiedGroupKFold

from pratirup.config import DATA_PROCESSED, N_FOLDS, SEED, TEST_FRACTION
from pratirup.data.download import SHANGHAI_DIR
from pratirup.data.shanghai import load_all

TABLES = ("recordings", "cgm", "fingersticks", "events")


def _frame_hash(df: pd.DataFrame) -> str:
    return hashlib.sha256(pd.util.hash_pandas_object(df, index=False).values.tobytes()).hexdigest()[:16]


def make_split(recordings: pd.DataFrame) -> dict:
    patients = (
        recordings.groupby("patient_id")
        .agg(rx_insulin=("rx_insulin", "max"))
        .reset_index()
        .sort_values("patient_id")
    )
    rng = np.random.default_rng(SEED)
    test: list[str] = []
    for _, grp in patients.groupby("rx_insulin"):
        ids = grp["patient_id"].to_numpy()
        k = int(round(len(ids) * TEST_FRACTION))
        test.extend(rng.choice(ids, size=k, replace=False).tolist())
    test = sorted(test)
    dev = patients[~patients["patient_id"].isin(test)].reset_index(drop=True)
    folds: dict[str, int] = {}
    sgkf = StratifiedGroupKFold(n_splits=N_FOLDS, shuffle=True, random_state=SEED)
    for k, (_, idx) in enumerate(sgkf.split(dev, dev["rx_insulin"], groups=dev["patient_id"])):
        for pid in dev.loc[idx, "patient_id"]:
            folds[pid] = k
    return {
        "seed": SEED,
        "unit": "patient",
        "stratified_by": "rx_insulin",
        "test_patients": test,
        "dev_folds": dict(sorted(folds.items())),
        "n_test": len(test),
        "n_dev": len(folds),
    }


def main() -> None:
    tables = load_all(SHANGHAI_DIR)
    DATA_PROCESSED.mkdir(parents=True, exist_ok=True)
    manifest = {"source": "ShanghaiT2DM (Zhao et al., Sci Data 2023), figshare 21600933 v5, CC BY 4.0", "tables": {}}
    for name in TABLES:
        df = tables[name]
        df.to_parquet(DATA_PROCESSED / f"shanghai_{name}.parquet", index=False)
        manifest["tables"][name] = {"rows": len(df), "hash": _frame_hash(df)}
        print(f"{name:13s} {len(df):7d} rows")
    split_path = DATA_PROCESSED / "split.json"
    if split_path.exists():
        print(f"Keeping existing split {split_path} (delete it deliberately to re-split)")
    else:
        split = make_split(tables["recordings"])
        split_path.write_text(json.dumps(split, indent=2))
        print(f"Split written: {split['n_dev']} dev patients, {split['n_test']} test patients")
    (DATA_PROCESSED / "manifest.json").write_text(json.dumps(manifest, indent=2))


if __name__ == "__main__":
    main()
