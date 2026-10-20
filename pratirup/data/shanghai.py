"""Parse ShanghaiT2DM into tidy tables.

Outputs (one row each):
  recordings  - one CGM recording period with the linked clinical record
  cgm         - one CGM reading on a regular 15-min grid
  fingersticks- one capillary blood glucose reading (display only)
  events      - one logged meal, insulin dose, oral agent or pump change

The clinical summary and the per-recording files are linked by the
"Patient Number" (e.g. 2000_0_20201230), which is also the file name.
"""

from __future__ import annotations

import re
from pathlib import Path

import numpy as np
import pandas as pd

from pratirup.config import GLUCOSE_MAX_VALID, GLUCOSE_MIN_VALID, STEP_MIN
from pratirup.data import vocab

RAW_COLUMNS = [
    "date", "cgm", "cbg", "ketone", "diet_en", "diet_cn", "insulin_sc",
    "oral", "csii_bolus", "csii_basal", "insulin_iv",
]

STATIC_COLUMNS = {
    "Patient Number": "recording_id",
    "Gender (Female=1, Male=2)": "sex_code",
    "Age (years)": "age",
    "Height (m)": "height_m",
    "Weight (kg)": "weight_kg",
    "BMI (kg/m2)": "bmi",
    "Smoking History (pack year)": "smoking_pack_years",
    "Alcohol Drinking History (drinker/non-drinker)": "alcohol",
    "Type of Diabetes": "diabetes_type",
    "Duration of diabetes (years)": "diabetes_duration_y",
    "Acute Diabetic Complications": "complications_acute",
    "Diabetic Macrovascular  Complications": "complications_macro",
    "Diabetic Microvascular Complications": "complications_micro",
    "Comorbidities": "comorbidities",
    "Hypoglycemic Agents": "glucose_lowering_agents",
    "Other Agents": "other_agents",
    "Fasting Plasma Glucose (mg/dl)": "fpg_mgdl",
    "2-hour Postprandial Plasma Glucose (mg/dl)": "ppg2h_mgdl",
    "Fasting C-peptide (nmol/L)": "cpeptide_fasting_nmol",
    "2-hour Postprandial C-peptide (nmol/L)": "cpeptide_2h_nmol",
    "Fasting Insulin (pmol/L)": "insulin_fasting_pmol",
    "2-hour Postprandial insulin (pmol/L)": "insulin_2h_pmol",
    "HbA1c (mmol/mol)": "hba1c_mmolmol",
    "Glycated Albumin (%)": "glycated_albumin_pct",
    "Total Cholesterol (mmol/L)": "tc_mmol",
    "Triglyceride (mmol/L)": "tg_mmol",
    "High-Density Lipoprotein Cholesterol (mmol/L)": "hdl_mmol",
    "Low-Density Lipoprotein Cholesterol (mmol/L)": "ldl_mmol",
    "Creatinine (umol/L)": "creatinine_umol",
    "Estimated Glomerular Filtration Rate  (ml/min/1.73m2) ": "egfr",
    "Uric Acid (mmol/L)": "uric_acid",
    "Blood Urea Nitrogen (mmol/L)": "bun_mmol",
    "Hypoglycemia (yes/no)": "hypoglycemia_flag",
}

NUMERIC_STATIC = [
    "age", "height_m", "weight_kg", "bmi", "smoking_pack_years", "diabetes_duration_y",
    "fpg_mgdl", "ppg2h_mgdl", "cpeptide_fasting_nmol", "cpeptide_2h_nmol",
    "insulin_fasting_pmol", "insulin_2h_pmol", "hba1c_mmolmol", "glycated_albumin_pct",
    "tc_mmol", "tg_mmol", "hdl_mmol", "ldl_mmol", "creatinine_umol", "egfr",
    "uric_acid", "bun_mmol",
]


def _has(text: str, *words: str) -> int:
    t = str(text).lower()
    return int(any(w in t for w in words))


def load_static(base: Path) -> pd.DataFrame:
    s = pd.read_excel(base / "Shanghai_T2DM_Summary.xlsx")
    missing = set(STATIC_COLUMNS) - set(s.columns)
    if missing:
        raise ValueError(f"Unexpected summary schema, missing: {missing}")
    s = s.rename(columns=STATIC_COLUMNS)[list(STATIC_COLUMNS.values())]
    for c in NUMERIC_STATIC:
        s[c] = pd.to_numeric(s[c], errors="coerce")
    for c in ["alcohol", "complications_acute", "complications_macro", "complications_micro",
              "comorbidities", "glucose_lowering_agents", "other_agents", "diabetes_type",
              "hypoglycemia_flag"]:
        s[c] = s[c].astype(str).str.strip()
    s["recording_id"] = s["recording_id"].astype(str).str.strip()
    s["patient_id"] = s["recording_id"].str.split("_").str[0]
    s["sex"] = s["sex_code"].map({1: "female", 2: "male"})
    s["is_male"] = (s["sex_code"] == 2).astype(int)
    s["is_drinker"] = (s["alcohol"].str.lower() == "drinker").astype(int)
    # IFCC mmol/mol -> NGSP %, the master equation: % = mmol/mol / 10.929 + 2.15
    s["hba1c_pct"] = (s["hba1c_mmolmol"] / 10.929 + 2.15).round(2)
    s["comp_neuropathy"] = s["complications_micro"].map(lambda x: _has(x, "neuropathy"))
    s["comp_retinopathy"] = s["complications_micro"].map(lambda x: _has(x, "retinopathy"))
    s["comp_nephropathy"] = s["complications_micro"].map(lambda x: _has(x, "nephropathy"))
    s["comp_macrovascular"] = s["complications_macro"].map(lambda x: int(x.lower() != "none"))
    s["comorb_hypertension"] = s["comorbidities"].map(lambda x: _has(x, "hypertension"))
    s["comorb_dyslipidemia"] = s["comorbidities"].map(lambda x: _has(x, "hyperlipidemia", "dyslipidemia"))
    s["comorb_fatty_liver"] = s["comorbidities"].map(lambda x: _has(x, "fatty liver"))
    flags = s["glucose_lowering_agents"].map(vocab.regimen_flags).apply(pd.Series)
    s = pd.concat([s, flags], axis=1)
    return s


def _assign_slots(ts: pd.Series, t0: pd.Timestamp) -> np.ndarray:
    minutes = (ts - t0).dt.total_seconds() / 60.0
    return np.round(minutes / STEP_MIN).astype(int)


def parse_recording(path: Path) -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame, pd.Timestamp]:
    rid = path.stem
    df = pd.read_excel(path)
    if df.shape[1] != len(RAW_COLUMNS):
        raise ValueError(f"{path.name}: expected {len(RAW_COLUMNS)} columns, got {df.shape[1]}")
    df.columns = RAW_COLUMNS
    df["date"] = pd.to_datetime(df["date"], errors="coerce")
    df = df.dropna(subset=["date"]).sort_values("date", kind="stable").reset_index(drop=True)
    t0 = df["date"].iloc[0].floor("min")
    df["slot"] = _assign_slots(df["date"], t0)

    g = pd.to_numeric(df["cgm"], errors="coerce")
    valid = g.between(GLUCOSE_MIN_VALID, GLUCOSE_MAX_VALID)
    cgm = (
        pd.DataFrame({"recording_id": rid, "slot": df["slot"], "ts": df["date"], "glucose": g})
        [valid]
        .drop_duplicates("slot", keep="first")
        .reset_index(drop=True)
    )

    cbg = pd.to_numeric(df["cbg"], errors="coerce")
    finger = pd.DataFrame({"recording_id": rid, "ts": df["date"], "glucose": cbg}).dropna()

    events: list[dict] = []

    def add(row, kind, detail, **kw):
        events.append({"recording_id": rid, "ts": row.date, "slot": int(row.slot), "kind": kind,
                       "detail": str(detail).strip(), **kw})

    for row in df.itertuples(index=False):
        if pd.notna(row.diet_en) and str(row.diet_en).strip():
            meal = vocab.parse_diet(row.diet_en)
            add(row, "meal", row.diet_en, grams=meal.total_grams, carb_grams=meal.carb_dense_grams,
                described=meal.described)
        if pd.notna(row.insulin_sc) and str(row.insulin_sc).strip():
            for d in vocab.parse_insulin(row.insulin_sc):
                add(row, "insulin", f"{d.name}, {d.units:g} IU", units=d.units, fast_units=d.fast_units,
                    basal_units=d.basal_units, category=d.category)
        if pd.notna(row.oral) and str(row.oral).strip():
            classes = vocab.oral_classes(row.oral)
            add(row, "oral", row.oral, classes="|".join(sorted(classes)),
                secretagogue=int(any(c in classes for c in vocab.SECRETAGOGUES)),
                agi=int("agi" in classes), biguanide=int("biguanide" in classes))
        bolus = pd.to_numeric(row.csii_bolus, errors="coerce")
        if pd.notna(bolus):
            add(row, "csii_bolus", f"Pump bolus (Novolin R), {bolus:g} IU", units=float(bolus),
                fast_units=float(bolus), basal_units=0.0, category="short")
        basal = pd.to_numeric(row.csii_basal, errors="coerce")
        if pd.notna(basal):
            add(row, "csii_basal_rate", f"Pump basal rate (Novolin R), {basal:g} IU/h", rate=float(basal))
        if pd.notna(row.insulin_iv) and re.search(r"[\d.]+\s*IU", str(row.insulin_iv)):
            units = sum(float(u) for u in re.findall(r"([\d.]+)\s*IU", str(row.insulin_iv)))
            add(row, "insulin_iv", row.insulin_iv, units=units, fast_units=units, basal_units=0.0,
                category="iv")

    ev = pd.DataFrame(events)
    return cgm, finger, ev, t0


def load_all(base: Path) -> dict[str, pd.DataFrame]:
    static = load_static(base)
    cgm_parts, finger_parts, ev_parts, meta = [], [], [], []
    files = sorted((base / "Shanghai_T2DM").glob("*.xls*"))
    for path in files:
        cgm, finger, ev, t0 = parse_recording(path)
        cgm_parts.append(cgm)
        finger_parts.append(finger)
        if len(ev):
            ev_parts.append(ev)
        meta.append({
            "recording_id": path.stem,
            "start_ts": t0,
            "end_ts": cgm["ts"].max(),
            "n_readings": len(cgm),
            "n_slots": int(cgm["slot"].max()) + 1,
            "source_file": path.name,
        })
    meta = pd.DataFrame(meta)
    unmatched = set(meta["recording_id"]) ^ set(static["recording_id"])
    if unmatched:
        raise ValueError(f"Recordings and clinical summary do not match: {sorted(unmatched)}")
    recordings = static.merge(meta, on="recording_id", how="inner")
    events = pd.concat(ev_parts, ignore_index=True)
    return {
        "recordings": recordings,
        "cgm": pd.concat(cgm_parts, ignore_index=True),
        "fingersticks": pd.concat(finger_parts, ignore_index=True),
        "events": events,
    }
