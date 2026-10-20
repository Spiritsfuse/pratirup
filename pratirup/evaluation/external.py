"""External evaluation on CGMacros (PhysioNet, CC BY-NC-SA 4.0).

Two questions, both answered on data the model never saw:

1. Transfer. Does the frozen model, trained only on ShanghaiT2DM, still beat
   the baselines on 45 free-living US adults (healthy, prediabetes, T2D) wearing
   a different Libre model? Inputs CGMacros does not record (medication, most
   labs, complications) are passed as missing, never as zero. Meal *timing*
   transfers; meal grams do not (CGMacros reports nutrient carbohydrate grams,
   ShanghaiT2DM reports food weights), so they are passed as missing.

2. Wearables. Inside CGMacros, do Fitbit heart rate and activity energy improve
   60-min forecasts over CGM alone? 5-fold participant-grouped CV, same
   LightGBM settings for both arms. Exploratory: n = 45.

CGMacros stores the Libre Pro channel linearly interpolated to 1 min; the
original 15-min readings are recovered by taking every 15th minute.
"""

from __future__ import annotations

import datetime as dt
import json

import numpy as np
import pandas as pd

from pratirup.config import HORIZONS_MIN, MODELS_DIR, RESULTS_DIR, SEED, horizon_slots
from pratirup.data.download import CGMACROS_DIR
from pratirup.evaluation import metrics as M
from pratirup.features import CGM_FEATURES, FEATURE_SETS, STATIC_FEATURES, TIME_FEATURES, Series, build_features, build_targets
from pratirup.models import lgbm
from pratirup.models import seq as gru
from pratirup.models.bundle import ModelBundle
from pratirup.twin.kalman import damped_forecast

MGDL_PER_MMOL_CHOL = 38.67
MGDL_PER_MMOL_TG = 88.57


def _group(a1c: float) -> str:
    if a1c >= 6.5:
        return "t2d"
    if a1c >= 5.7:
        return "prediabetes"
    return "healthy"


def _static(row: pd.Series) -> dict:
    s = {k: np.nan for k in STATIC_FEATURES}
    ldl = row.get("LDL (Cal)")
    s.update({
        "age": row["Age"], "is_male": 1.0 if str(row["Gender"]).upper().startswith("M") else 0.0,
        "bmi": row["BMI"], "hba1c_pct": row["A1c PDL (Lab)"],   # dataset labels it mmol/mol; values are %
        "fpg_mgdl": row["Fasting GLU - PDL (Lab)"],
        "insulin_fasting_pmol": row["Insulin "] * 6.0 if pd.notna(row["Insulin "]) else np.nan,
        "tc_mmol": row["Cholesterol"] / MGDL_PER_MMOL_CHOL,
        "tg_mmol": row["Triglycerides"] / MGDL_PER_MMOL_TG,
        "hdl_mmol": row["HDL"] / MGDL_PER_MMOL_CHOL,
        "ldl_mmol": (ldl / MGDL_PER_MMOL_CHOL) if pd.notna(ldl) and ldl < 800 else np.nan,
    })
    return s


def load_cgmacros() -> tuple[dict[str, Series], dict[str, pd.DataFrame], pd.DataFrame]:
    base = CGMACROS_DIR / "csv" / "CGMacros"
    bio = pd.read_csv(base / "bio.csv")
    series, minute = {}, {}
    rows = []
    for _, b in bio.iterrows():
        sid = f"CGMacros-{int(b['subject']):03d}"
        path = base / sid / f"{sid}.csv"
        if not path.exists():
            continue
        d = pd.read_csv(path)
        d["Timestamp"] = pd.to_datetime(d["Timestamp"])
        d = d.sort_values("Timestamp").reset_index(drop=True)
        d = d[d["Libre GL"].notna()].reset_index(drop=True)
        if len(d) < 15 * 96:
            continue
        t0 = d["Timestamp"].iloc[0]
        mins = ((d["Timestamp"] - t0).dt.total_seconds() // 60).astype(int)
        knots = d[mins % 15 == 0]
        slots = (mins[mins % 15 == 0] // 15).to_numpy()
        n = int(slots.max()) + 1
        g = np.full(n, np.nan)
        g[slots] = knots["Libre GL"].to_numpy()
        meal = np.zeros(n)
        mt = d[d["Meal Type"].notna()]
        ms = np.round(((mt["Timestamp"] - t0).dt.total_seconds() / 60 / 15).to_numpy()).astype(int)
        meal[ms[ms < n]] = 1
        z = np.zeros(n)
        series[sid] = Series(sid, sid, t0, g, meal, np.full(n, np.nan), np.full(n, np.nan), z.copy(), z.copy(),
                             np.full(n, np.nan), z.copy(), z.copy(), z.copy(), z.copy(), static=_static(b))
        minute[sid] = d.assign(minute=mins)
        rows.append({"subject": sid, "group": _group(float(b["A1c PDL (Lab)"])), "hba1c_pct": float(b["A1c PDL (Lab)"]),
                     "days": float(n / 96)})
    return series, minute, pd.DataFrame(rows)


def _wearable_features(minute: pd.DataFrame, n_slots: int) -> pd.DataFrame:
    """Causal rolling HR / METs summaries ending at each 15-min slot."""
    # Heart rate is present for every participant. Fitbit activity energy
    # ("Calories (Activity)", kcal/min) is present for 44 of 45; METs are missing
    # for 11 (they have a coarse "Intensity" level instead), so METs are not used.
    m = minute.set_index("minute")
    full = pd.RangeIndex(0, n_slots * 15)
    hr = pd.to_numeric(m["HR"], errors="coerce").reindex(full)
    act = (pd.to_numeric(m["Calories (Activity)"], errors="coerce").reindex(full)
           if "Calories (Activity)" in m.columns else pd.Series(np.nan, index=full))
    out = pd.DataFrame(index=full)
    out["hr_mean_15"] = hr.rolling(15, min_periods=5).mean()
    out["hr_mean_60"] = hr.rolling(60, min_periods=20).mean()
    out["hr_sd_60"] = hr.rolling(60, min_periods=20).std()
    out["hr_delta_60"] = out["hr_mean_15"] - hr.rolling(120, min_periods=40).mean()
    out["act_kcal_15"] = act.rolling(15, min_periods=5).sum()
    out["act_kcal_60"] = act.rolling(60, min_periods=20).sum()
    out["act_max_60"] = act.rolling(60, min_periods=20).max()
    out["active_min_60"] = (act > 3).astype(float).where(act.notna()).rolling(60, min_periods=20).sum()
    return out.iloc[np.arange(n_slots) * 15].reset_index(drop=True)


WEARABLE_FEATURES = ["hr_mean_15", "hr_mean_60", "hr_sd_60", "hr_delta_60", "act_kcal_15", "act_kcal_60",
                     "act_max_60", "active_min_60"]


def run_external() -> dict:
    import lightgbm as lgb

    series, minute, subjects = load_cgmacros()
    bundle = ModelBundle.load(MODELS_DIR)
    kp = bundle.kalman
    abl = MODELS_DIR / "ablation"
    ladder_cgm = {h: lgb.Booster(model_file=str(abl / f"forecast_cgm_{h}min.txt")) for h in HORIZONS_MIN}
    gru_model, gru_norm = gru.load(abl / "gru.pt")

    parts = []
    for sid, s in series.items():
        f = build_features(s, kp)
        t = build_targets(s)
        w = _wearable_features(minute[sid], s.n)
        parts.append(pd.concat([f, t, w], axis=1))
    data = pd.concat(parts, ignore_index=True)
    data = data[data["issuable"]].reset_index(drop=True)
    data["group"] = data["recording_id"].map(subjects.set_index("subject")["group"])
    out = bundle.predict(data)
    gpred = gru.predict(gru_model, gru_norm, gru.sequences(series, data), data[gru.CONTEXT_FEATURES].to_numpy(dtype=np.float32))

    transfer: dict = {}
    for h in HORIZONS_MIN:
        m = np.isfinite(data[f"dy_{h}"].to_numpy())
        d = data[m].reset_index(drop=True)
        y, g0 = d[f"y_{h}"].to_numpy(), d["g0"].to_numpy()
        preds = {
            "persistence": g0,
            "kalman_trend": damped_forecast(d["kf_level"].to_numpy(), d["kf_slope"].to_numpy(), horizon_slots(h), kp.phi),
            "lgbm[cgm]": g0 + ladder_cgm[h].predict(d[FEATURE_SETS["cgm"]]),
            "gru_seq": g0 + gpred[m, HORIZONS_MIN.index(h)],
            "lgbm[full]": out[f"yhat_{h}"][m],
        }
        lo, hi = out[f"lo_{h}"][m], out[f"hi_{h}"][m]
        entry = {}
        for grp in ("all", "healthy", "prediabetes", "t2d"):
            sel = np.ones(len(d), bool) if grp == "all" else (d["group"] == grp).to_numpy()
            if not sel.any():
                continue
            entry[grp] = {
                "subjects": int(d.loc[sel, "recording_id"].nunique()),
                "models": {k: {**M.point_metrics(y[sel], v[sel]), "parkes_AB": M.parkes_summary(y[sel], v[sel])["A+B"]}
                           for k, v in preds.items()},
                "interval_coverage": float(np.mean((y[sel] >= lo[sel]) & (y[sel] <= hi[sel]))),
                "interval_width": float(np.mean(hi[sel] - lo[sel])),
            }
        transfer[str(h)] = entry

    # Hyperglycaemia alerts in people with T2D / prediabetes (threshold frozen from ShanghaiT2DM).
    ev = {}
    glucose = {sid: s.glucose for sid, s in series.items()}
    for grp in ("t2d", "prediabetes", "healthy"):
        d = data[(data["group"] == grp) & np.isfinite(data["ev_hyper"].to_numpy())].reset_index(drop=True)
        if d.empty:
            continue
        p = bundle.calibrators["hyper"](bundle.classifiers["hyper"].predict(d[bundle.features]))
        recs = []
        for rid, idx in d.groupby("recording_id").indices.items():
            g = glucose[rid]
            recs.append({"slots": d["slot"].to_numpy()[idx], "score": p[idx], "onsets": M.episode_onsets(g, "hyper"),
                         "n_readings": int(np.isfinite(g).sum())})
        ev[grp] = {"sample": M.sample_event_metrics(d["ev_hyper"].to_numpy(), p),
                   "event": M.event_level(recs, bundle.thresholds["hyper"])}

    # Wearable experiment inside CGMacros (participant-grouped CV).
    rng = np.random.default_rng(SEED)
    subj = np.array(sorted(data["recording_id"].unique()))
    rng.shuffle(subj)
    fold_of = {s: i % 5 for i, s in enumerate(subj)}
    data["fold"] = data["recording_id"].map(fold_of)
    base_feats = CGM_FEATURES + TIME_FEATURES + ["min_since_meal", "meals_3h"]
    params = bundle.meta["lgbm_params"]
    params = {k: v for k, v in params.items() if k in ("num_leaves", "min_data_in_leaf", "feature_fraction", "lambda_l2")}
    wear = {}
    for h in (30, 60):
        d = data[np.isfinite(data[f"dy_{h}"].to_numpy())].reset_index(drop=True)
        y = d[f"y_{h}"].to_numpy()
        res = {}
        for arm, feats in (("cgm_meals", base_feats), ("cgm_meals_wearable", base_feats + WEARABLE_FEATURES)):
            cv = lgbm.cross_validate(d[feats], d[f"dy_{h}"].to_numpy(), d["recording_id"].to_numpy(), d["fold"].to_numpy(), params)
            res[arm] = d["g0"].to_numpy() + cv.oof
        bf = d[["recording_id"]].rename(columns={"recording_id": "patient_id"}).assign(y=y, a=res["cgm_meals_wearable"], b=res["cgm_meals"])
        wear[str(h)] = {
            "mae_cgm_meals": float(np.mean(np.abs(res["cgm_meals"] - y))),
            "mae_cgm_meals_wearable": float(np.mean(np.abs(res["cgm_meals_wearable"] - y))),
            "mae_persistence": float(np.mean(np.abs(d["g0"].to_numpy() - y))),
            "bootstrap_wearable_minus_cgm": M.bootstrap_mae_diff(bf, "a", "b"),
            "n_rows": int(len(d)),
        }

    result = {
        "dataset": "CGMacros v1.0.0 (Das et al., Scientific Data 2025), PhysioNet, CC BY-NC-SA 4.0",
        "generated_at": dt.datetime.now().isoformat(timespec="seconds"),
        "subjects": subjects.groupby("group").size().to_dict(),
        "notes": [
            "Frozen ShanghaiT2DM model; no refitting on CGMacros for the transfer test.",
            "Missing inputs (medications, most labs, complications, meal grams) passed as missing.",
            "Groups by HbA1c: <5.7% healthy, 5.7-6.4% prediabetes, >=6.5% T2D.",
            "Wearable experiment is exploratory (45 participants); features use heart rate and Fitbit activity energy.",
        ],
        "transfer": transfer,
        "hyper_alerts": ev,
        "wearables": wear,
    }
    RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    (RESULTS_DIR / "external.json").write_text(json.dumps(result, indent=2, default=float))
    print(json.dumps({h: {g: {k: round(v["mae"], 2) for k, v in e["models"].items()} for g, e in d.items()}
                      for h, d in transfer.items()}, indent=1))
    print(json.dumps(wear, indent=1))
    return result
