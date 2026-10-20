"""Represent a ShanghaiT2DM clinical record as a FHIR R4 Bundle.

This is the "static / historical" stream of the twin. Values come from the
de-identified research record; nothing is synthesised. Codes are included only
where the mapping is unambiguous; other items carry text only. The dataset
records age, not date of birth, so no birthDate is emitted.
"""

from __future__ import annotations

import math
from typing import Any

import pandas as pd

LOINC = "http://loinc.org"
SNOMED = "http://snomed.info/sct"
UCUM = "http://unitsofmeasure.org"

# column -> (display, unit, ucum code, loinc code or None)
LAB_MAP: dict[str, tuple[str, str, str, str | None]] = {
    "hba1c_mmolmol": ("HbA1c (IFCC)", "mmol/mol", "mmol/mol", "59261-8"),
    "fpg_mgdl": ("Fasting plasma glucose", "mg/dL", "mg/dL", "1558-6"),
    "ppg2h_mgdl": ("2-h postprandial plasma glucose", "mg/dL", "mg/dL", None),
    "cpeptide_fasting_nmol": ("Fasting C-peptide", "nmol/L", "nmol/L", None),
    "cpeptide_2h_nmol": ("2-h postprandial C-peptide", "nmol/L", "nmol/L", None),
    "insulin_fasting_pmol": ("Fasting insulin", "pmol/L", "pmol/L", None),
    "insulin_2h_pmol": ("2-h postprandial insulin", "pmol/L", "pmol/L", None),
    "glycated_albumin_pct": ("Glycated albumin", "%", "%", None),
    "tc_mmol": ("Total cholesterol", "mmol/L", "mmol/L", "14647-2"),
    "tg_mmol": ("Triglycerides", "mmol/L", "mmol/L", "14927-8"),
    "hdl_mmol": ("HDL cholesterol", "mmol/L", "mmol/L", "14646-4"),
    "ldl_mmol": ("LDL cholesterol", "mmol/L", "mmol/L", "22748-8"),
    "creatinine_umol": ("Creatinine", "umol/L", "umol/L", "14682-9"),
    "egfr": ("eGFR", "mL/min/1.73m2", "mL/min/{1.73_m2}", None),
    "uric_acid": ("Uric acid", "umol/L", "umol/L", None),
    "bun_mmol": ("Blood urea nitrogen", "mmol/L", "mmol/L", None),
}
VITAL_MAP: dict[str, tuple[str, str, str, str]] = {
    "bmi": ("Body mass index", "kg/m2", "kg/m2", "39156-5"),
    "weight_kg": ("Body weight", "kg", "kg", "29463-7"),
    "height_m": ("Body height", "m", "m", "8302-2"),
}
CONDITION_MAP: dict[str, tuple[str, str]] = {
    "type 2 diabetes": ("44054006", "Type 2 diabetes mellitus"),
    "hypertension": ("38341003", "Hypertensive disorder"),
    "hyperlipidemia": ("55822004", "Hyperlipidemia"),
    "neuropathy": ("230572002", "Diabetic neuropathy"),
    "retinopathy": ("4855003", "Diabetic retinopathy"),
    "nephropathy": ("127013003", "Diabetic renal disease"),
    "peripheral arterial disease": ("399957001", "Peripheral arterial occlusive disease"),
    "coronary heart disease": ("53741008", "Coronary arteriosclerosis"),
    "cerebrovascular disease": ("62914000", "Cerebrovascular disease"),
}


def _num(v: Any) -> float | None:
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return None if math.isnan(f) else f


def _condition(pid: str, idx: int, text: str, category: str) -> dict:
    key = text.strip().lower()
    code = CONDITION_MAP.get(key)
    concept: dict[str, Any] = {"text": text.strip()}
    if code:
        concept["coding"] = [{"system": SNOMED, "code": code[0], "display": code[1]}]
    return {
        "resourceType": "Condition",
        "id": f"{pid}-cond-{idx}",
        "subject": {"reference": f"Patient/{pid}"},
        "category": [{"text": category}],
        "clinicalStatus": {"coding": [{"system": "http://terminology.hl7.org/CodeSystem/condition-clinical", "code": "active"}]},
        "code": concept,
    }


def record_to_bundle(rec: pd.Series) -> dict:
    pid = str(rec["recording_id"])
    effective = pd.Timestamp(rec["start_ts"]).isoformat()
    entries: list[dict] = []
    entries.append({
        "resourceType": "Patient",
        "id": pid,
        "gender": rec.get("sex"),
        "extension": [{
            "url": "https://pratirup.local/fhir/StructureDefinition/age-at-recording",
            "valueAge": {"value": _num(rec["age"]), "unit": "a", "system": UCUM, "code": "a"},
        }],
        "meta": {"tag": [{"code": "research-deidentified", "display": "ShanghaiT2DM, CC BY 4.0"}]},
    })
    idx = 0
    entries.append(_condition(pid, idx, "Type 2 diabetes", "diagnosis"))
    for col, category in [("complications_micro", "microvascular complication"),
                          ("complications_macro", "macrovascular complication"),
                          ("comorbidities", "comorbidity")]:
        for part in str(rec[col]).split(","):
            if part.strip() and part.strip().lower() != "none":
                idx += 1
                entries.append(_condition(pid, idx, part, category))
    for col, (display, unit, ucum, loinc) in {**LAB_MAP, **VITAL_MAP}.items():
        v = _num(rec.get(col))
        if v is None:
            continue
        code: dict[str, Any] = {"text": display}
        if loinc:
            code["coding"] = [{"system": LOINC, "code": loinc, "display": display}]
        entries.append({
            "resourceType": "Observation",
            "id": f"{pid}-{col}",
            "status": "final",
            "category": [{"text": "vital-signs" if col in VITAL_MAP else "laboratory"}],
            "subject": {"reference": f"Patient/{pid}"},
            "effectiveDateTime": effective,
            "code": code,
            "valueQuantity": {"value": v, "unit": unit, "system": UCUM, "code": ucum},
            "note": [{"text": "Drawn within 6 months of the CGM recording (dataset protocol)."}] if col in LAB_MAP else [],
        })
    for i, (col, label) in enumerate([("glucose_lowering_agents", "glucose-lowering"), ("other_agents", "other")]):
        text = str(rec[col]).strip()
        if text and text.lower() != "none":
            entries.append({
                "resourceType": "MedicationStatement",
                "id": f"{pid}-med-{i}",
                "status": "active",
                "subject": {"reference": f"Patient/{pid}"},
                "category": {"text": label},
                "medicationCodeableConcept": {"text": text},
            })
    smoking = _num(rec.get("smoking_pack_years"))
    entries.append({
        "resourceType": "Observation",
        "id": f"{pid}-smoking",
        "status": "final",
        "subject": {"reference": f"Patient/{pid}"},
        "code": {"text": "Tobacco use, pack-years"},
        "valueQuantity": {"value": smoking, "unit": "pack-years"},
    })
    entries.append({
        "resourceType": "Observation",
        "id": f"{pid}-genetics",
        "status": "registered",
        "subject": {"reference": f"Patient/{pid}"},
        "code": {"text": "Genetic markers"},
        "dataAbsentReason": {"text": "Not recorded in the source dataset"},
    })
    return {
        "resourceType": "Bundle",
        "type": "collection",
        "id": f"{pid}-record",
        "entry": [{"resource": r} for r in entries],
    }
