"""Plain-language names for model inputs, used when explaining a forecast."""

FEATURE_LABELS: dict[str, str] = {
    "g0": "Current glucose",
    "d1": "Change over last 15 min",
    "d2": "Change over last 30 min",
    "d3": "Change over last 45 min",
    "d4": "Change over last 60 min",
    "d6": "Change over last 90 min",
    "d8": "Change over last 2 h",
    "d12": "Change over last 3 h",
    "accel": "Acceleration of glucose",
    "mean_1h": "Mean glucose, last hour",
    "sd_1h": "Variability, last hour",
    "min_1h": "Lowest glucose, last hour",
    "max_1h": "Highest glucose, last hour",
    "mean_3h": "Mean glucose, last 3 h",
    "sd_3h": "Variability, last 3 h",
    "min_3h": "Lowest glucose, last 3 h",
    "max_3h": "Highest glucose, last 3 h",
    "n_missing_3h": "Missing readings, last 3 h",
    "roughness_3h": "Signal roughness (sensor noise), last 3 h",
    "kf_level": "Filtered glucose level",
    "kf_slope": "Filtered rate of change",
    "kf_level_sd": "Uncertainty of filtered level",
    "kf_slope_sd": "Uncertainty of filtered rate",
    "kf_resid": "Latest reading vs filtered level",
    "tod_sin": "Time of day",
    "tod_cos": "Time of day",
    "hours_since_start": "Hours since sensor start",
    "min_since_meal": "Time since last logged meal",
    "last_meal_grams": "Size of last logged meal",
    "last_meal_carb_grams": "Carbohydrate-dense food in last meal",
    "carb_on_board": "Recent carbohydrate-dense food (decayed)",
    "meals_3h": "Meals logged in last 3 h",
    "min_since_fast_insulin": "Time since last fast-acting insulin",
    "fast_iob": "Fast-acting insulin on board (decayed)",
    "fast_units_4h": "Fast-acting insulin, last 4 h",
    "basal_units_24h": "Basal insulin, last 24 h",
    "pump_basal_rate": "Pump basal rate",
    "min_since_secretagogue": "Time since sulfonylurea / glinide",
    "min_since_agi": "Time since alpha-glucosidase inhibitor",
    "min_since_biguanide": "Time since metformin",
    "min_since_oral": "Time since any oral agent",
    "exp_mean": "Mean glucose so far (this wear)",
    "exp_sd": "Glucose variability so far",
    "exp_tar": "Time above 180 so far",
    "exp_tbr": "Time below 70 so far",
    "prof_level": "Usual glucose at this time of day",
    "prof_days": "Days of personal history",
    "prof_delta_30": "Usual 30-min change at this time of day",
    "prof_delta_60": "Usual 60-min change at this time of day",
    "prof_delta_120": "Usual 2-h change at this time of day",
    "age": "Age",
    "is_male": "Sex",
    "bmi": "BMI",
    "diabetes_duration_y": "Diabetes duration",
    "hba1c_pct": "HbA1c",
    "glycated_albumin_pct": "Glycated albumin",
    "fpg_mgdl": "Fasting plasma glucose (lab)",
    "ppg2h_mgdl": "2-h postprandial glucose (lab)",
    "cpeptide_fasting_nmol": "Fasting C-peptide",
    "cpeptide_2h_nmol": "2-h C-peptide",
    "insulin_fasting_pmol": "Fasting insulin (lab)",
    "insulin_2h_pmol": "2-h insulin (lab)",
    "tc_mmol": "Total cholesterol",
    "tg_mmol": "Triglycerides",
    "hdl_mmol": "HDL cholesterol",
    "ldl_mmol": "LDL cholesterol",
    "creatinine_umol": "Creatinine",
    "egfr": "eGFR",
    "uric_acid": "Uric acid",
    "bun_mmol": "Blood urea nitrogen",
    "smoking_pack_years": "Smoking (pack-years)",
    "is_drinker": "Alcohol use",
    "comp_neuropathy": "Neuropathy",
    "comp_retinopathy": "Retinopathy",
    "comp_nephropathy": "Nephropathy",
    "comp_macrovascular": "Macrovascular disease",
    "comorb_hypertension": "Hypertension",
    "comorb_dyslipidemia": "Dyslipidaemia",
    "comorb_fatty_liver": "Fatty liver disease",
    "rx_insulin": "On insulin",
    "rx_biguanide": "On metformin",
    "rx_agi": "On alpha-glucosidase inhibitor",
    "rx_sulfonylurea": "On sulfonylurea",
    "rx_glinide": "On glinide",
    "rx_dpp4": "On DPP-4 inhibitor",
    "rx_sglt2": "On SGLT2 inhibitor",
    "rx_tzd": "On thiazolidinedione",
    "rx_glp1": "On GLP-1 receptor agonist",
}

FEATURE_SOURCE: dict[str, str] = {}
for _k in FEATURE_LABELS:
    if _k.startswith(("g0", "d", "accel", "mean_", "sd_", "min_1", "min_3", "max_", "n_missing", "kf_", "roughness")) and not _k.startswith("diabetes"):
        FEATURE_SOURCE[_k] = "cgm"
    elif _k in ("tod_sin", "tod_cos", "hours_since_start"):
        FEATURE_SOURCE[_k] = "time"
    elif _k.startswith(("min_since", "last_meal", "carb_on", "meals_", "fast_", "basal_", "pump_")):
        FEATURE_SOURCE[_k] = "logs"
    elif _k.startswith(("exp_", "prof_")):
        FEATURE_SOURCE[_k] = "personal history"
    else:
        FEATURE_SOURCE[_k] = "clinical record"


def trend_arrow(slope_per_15min: float) -> str:
    """Rate-of-change arrow on the convention used by CGM devices (mg/dL/min)."""
    r = slope_per_15min / 15.0
    if r > 3:
        return "rising_fast"
    if r > 2:
        return "rising"
    if r > 1:
        return "rising_slow"
    if r >= -1:
        return "steady"
    if r >= -2:
        return "falling_slow"
    if r >= -3:
        return "falling"
    return "falling_fast"
