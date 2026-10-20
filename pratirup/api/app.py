"""HTTP API for the Pratirup clinician app.

Time model: every replay patient is placed on a shared demo clock measured in
minutes ("demo minutes" = wear-day index * 1440 + minute of day). A request
with ?t= asks "what did the twin know at that moment?". Nothing recorded
after t is returned, and a past forecast's outcome is shown only once its
target time is <= t.
"""

from __future__ import annotations

import copy
import json
import math
import threading
import time
from pathlib import Path

import numpy as np
import pandas as pd
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from pratirup import __version__
from pratirup.config import (
    HORIZONS_MIN, HYPER, HYPER_L2, HYPO, HYPO_L2, MAX_STALENESS_MIN, MODELS_DIR, RESULTS_DIR, ROOT,
    STEP_MIN,
)
from pratirup.data import vocab
from pratirup.features import build_features
from pratirup.models.bundle import EVENT_KINDS
from pratirup.twin.engine import LiveTwin, at_risk, demo_minutes
from pratirup.twin.labels import FEATURE_LABELS, FEATURE_SOURCE, trend_arrow
from pratirup.api.store import STATE_COLS, Store, _none

DISCLAIMER = (
    "Research prototype. Not a medical device. Forecasts are experimental, were evaluated "
    "retrospectively on a Chinese hospital cohort, and must be interpreted by a qualified clinician."
)
EVENT_LABEL = {"hyper": "Glucose likely to exceed 180 mg/dL within 60 min",
               "hyper2": "Glucose likely to exceed 250 mg/dL within 60 min",
               "hypo": "Glucose likely to fall below 70 mg/dL within 60 min"}

app = FastAPI(title="Pratirup API", version=__version__)


@app.on_event("startup")
def _warm_store() -> None:
    """Build or open the database before the first request, not during it."""
    store()

app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
                   allow_methods=["*"], allow_headers=["*"])
_store: Store | None = None
_store_lock = threading.Lock()


def store() -> Store:
    global _store
    with _store_lock:
        if _store is None:
            _store = Store()
        return _store


# ---------------------------------------------------------------------------
# helpers


def clock_label(t: int) -> str:
    day, m = divmod(int(t), 1440)
    return f"Day {day + 1} · {m // 60:02d}:{m % 60:02d}"


def _f(v):
    if v is None:
        return None
    try:
        x = float(v)
    except (TypeError, ValueError):
        return v
    return None if math.isnan(x) else x


def _rec(rid: str):
    r = store().one("SELECT * FROM recording WHERE rid=?", (rid,))
    if r is None:
        raise HTTPException(404, f"Unknown patient recording '{rid}'")
    return r


def _resolve_t(rec, t: int | None) -> int:
    if rec["mode"] == "live":
        last = store().one("SELECT MAX(demo_min) m FROM observation WHERE rid=?", (rec["rid"],))
        return int(last["m"]) if last and last["m"] is not None else int(rec["start_demo"])
    if t is None:
        return default_clock()
    return int(t)


def default_clock() -> int:
    rows = store().query("SELECT start_demo, end_demo FROM recording WHERE mode='replay'")
    if not rows:
        return 0
    candidate = 2 * 1440 + 7 * 60 + 30      # Day 3, 07:30
    lo = max(r["start_demo"] for r in rows)
    return candidate if candidate >= lo else lo + 240


def _latest_state(rid: str, t: int):
    return store().one(
        "SELECT * FROM twin_state WHERE rid=? AND demo_min<=? AND glucose IS NOT NULL ORDER BY demo_min DESC LIMIT 1",
        (rid, t))


def _status(rec, t: int, last) -> tuple[str, int | None]:
    if t < rec["start_demo"]:
        return "not_started", None
    if last is None:
        return "warming_up", None
    since = t - int(last["demo_min"])
    if rec["mode"] == "replay" and t > rec["end_demo"] + MAX_STALENESS_MIN:
        return "ended", since
    if since > MAX_STALENESS_MIN:
        return "no_recent_data", since
    return "monitoring", since


def _range_stats(rid: str, t: int, minutes: int = 1440) -> dict:
    rows = store().query("SELECT glucose FROM observation WHERE rid=? AND demo_min>? AND demo_min<=?",
                         (rid, t - minutes, t))
    g = np.array([r["glucose"] for r in rows], dtype=float)
    if len(g) == 0:
        return {"n": 0}
    expected = minutes // STEP_MIN
    return {
        "n": int(len(g)),
        "coverage": float(min(1.0, len(g) / expected)),
        "mean": float(g.mean()),
        "cv_pct": float(g.std() / g.mean() * 100) if len(g) > 1 else None,
        "tir": float(np.mean((g >= HYPO) & (g <= HYPER))),
        "tar": float(np.mean(g > HYPER)),
        "tar_l2": float(np.mean(g > HYPER_L2)),
        "tbr": float(np.mean(g < HYPO)),
        "tbr_l2": float(np.mean(g < HYPO_L2)),
        "gmi_pct": float(3.31 + 0.02392 * g.mean()),
    }


def _risk(state) -> dict:
    b = store().bundle
    out = {}
    for kind in EVENT_KINDS:
        p = _f(state[f"p_{kind}"]) if state is not None else None
        out[kind] = {
            "p": p,
            "threshold": b.thresholds[kind],
            "at_risk": p is not None,
            "above_threshold": p is not None and p >= b.thresholds[kind],
            "label": EVENT_LABEL[kind],
        }
    return out


def _priority(state, status: str, stats: dict, risk: dict) -> tuple[int, str, str]:
    """Lower tier = review first. Encodes consensus targets, not model output alone."""
    g = _f(state["glucose"]) if state is not None else None
    if status in ("not_started", "warming_up"):
        return 6, "waiting", "Waiting for enough CGM data"
    if status == "ended":
        return 6, "ended", "CGM wear finished"
    if status == "no_recent_data":
        return 3, "data", "No CGM reading in the last 30 min"
    if g is not None and g < HYPO_L2:
        return 0, "urgent", f"Glucose {g:.0f} mg/dL, below 54"
    if g is not None and g < HYPO:
        return 0, "urgent", f"Glucose {g:.0f} mg/dL, below 70"
    if risk["hypo"]["above_threshold"]:
        return 1, "act", "Predicted to fall below 70 within 60 min"
    if g is not None and g > HYPER_L2:
        return 1, "act", f"Glucose {g:.0f} mg/dL, above 250"
    if risk["hyper2"]["above_threshold"]:
        return 2, "watch", "Predicted to exceed 250 within 60 min"
    if risk["hyper"]["above_threshold"]:
        return 2, "watch", "Predicted to exceed 180 within 60 min"
    if stats.get("n", 0) >= 48 and (stats["tbr"] > 0.04 or stats["tar"] > 0.25):
        reason = "Time below range above 4%" if stats["tbr"] > 0.04 else "Time above range above 25% (24 h)"
        return 4, "review", reason
    return 5, "stable", "Within targets"


def _format_value(feature: str, v, slot_ts: pd.Timestamp | None = None) -> str:
    if v is None or (isinstance(v, float) and math.isnan(v)):
        return "not recorded" if feature in FEATURE_SOURCE and FEATURE_SOURCE[feature] == "clinical record" else "none logged"
    v = float(v)
    if feature.startswith("min_since"):
        return "> 12 h" if v >= 720 else f"{v:.0f} min ago"
    if feature in ("g0", "mean_1h", "mean_3h", "min_1h", "min_3h", "max_1h", "max_3h", "kf_level", "prof_level",
                   "exp_mean", "fpg_mgdl", "ppg2h_mgdl"):
        return f"{v:.0f} mg/dL"
    if feature.startswith(("d", "prof_delta")) and feature[1:].isdigit() or feature.startswith("prof_delta") or feature == "accel":
        return f"{v:+.0f} mg/dL"
    if feature in ("kf_slope",):
        return f"{v / STEP_MIN:+.1f} mg/dL/min"
    if feature in ("tod_sin", "tod_cos"):
        return slot_ts.strftime("%H:%M") if slot_ts is not None else ""
    if feature == "hba1c_pct":
        return f"{v:.1f}%"
    if feature in ("exp_tar", "exp_tbr"):
        return f"{v * 100:.0f}%"
    if feature.startswith(("rx_", "comp_", "comorb_")) or feature in ("is_drinker",):
        return "yes" if v >= 0.5 else "no"
    if feature == "is_male":
        return "male" if v >= 0.5 else "female"
    if feature in ("fast_iob", "fast_units_4h", "basal_units_24h"):
        return f"{v:.1f} IU"
    if feature == "pump_basal_rate":
        return f"{v:.2f} IU/h"
    if feature in ("last_meal_grams", "last_meal_carb_grams", "carb_on_board"):
        return f"{v:.0f} g"
    if feature == "diabetes_duration_y":
        return f"{v:.0f} years"
    if feature == "age":
        return f"{v:.0f} years"
    return f"{v:.3g}"


def _drivers(contrib: pd.Series, feats: pd.Series, slot_ts, k: int = 6) -> list[dict]:
    c = contrib.drop(labels=["bias"], errors="ignore")
    # tod_sin / tod_cos are one concept; merge them.
    if "tod_sin" in c and "tod_cos" in c:
        c = c.copy()
        c["tod_sin"] = c["tod_sin"] + c["tod_cos"]
        c = c.drop(labels=["tod_cos"])
    top = c.reindex(c.abs().sort_values(ascending=False).index)[:k]
    return [{
        "feature": f, "label": FEATURE_LABELS.get(f, f), "source": FEATURE_SOURCE.get(f, "cgm"),
        "value": _format_value(f, _f(feats.get(f)), slot_ts), "contribution": float(v),
    } for f, v in top.items()]


def _features_for(rec, slot: int) -> pd.Series | None:
    s = store()
    if rec["mode"] == "live":
        sess = LIVE.get(rec["rid"])
        if sess is None:
            return None
        with sess.lock:
            f = sess.twin.features_now()
        return f.iloc[slot] if slot < len(f) else None
    f = s.features.get(rec["rid"])
    return f.iloc[slot] if f is not None and slot < len(f) else None


# ---------------------------------------------------------------------------
# endpoints


@app.get("/api/health")
def health():
    return {"ok": True, "version": __version__}


@app.get("/api/meta")
def meta():
    s = store()
    rows = s.query("SELECT start_demo, end_demo FROM recording WHERE mode='replay'")
    b = s.bundle
    return {
        "product": "Pratirup",
        "version": __version__,
        "disclaimer": DISCLAIMER,
        "clock": {"min": min(r["start_demo"] for r in rows), "max": max(r["end_demo"] for r in rows),
                  "step_min": STEP_MIN, "default": default_clock()},
        "thresholds_mgdl": {"hypo_l2": HYPO_L2, "hypo": HYPO, "hyper": HYPER, "hyper_l2": HYPER_L2},
        "horizons_min": list(HORIZONS_MIN),
        "alert_thresholds": b.thresholds,
        "model": {k: b.meta.get(k) for k in ("trained_at", "git_commit", "train_patients", "seed")},
        "personalisation": {str(k): v for k, v in b.personal.items()},
        "provenance": {
            "clinical_record": "De-identified research record (ShanghaiT2DM, CC BY 4.0). Real, not synthetic.",
            "cgm": "Real CGM readings from held-out patients, replayed on a demo clock.",
            "forecast": "Model output. Experimental.",
            "sensitivity": "Model sensitivity to a changed input. Associational, not causal.",
            "time_shift": "The demo clock shows real wear days and clock times. The raw FHIR record keeps the dataset's original dates.",
        },
        "demo_population": "20 held-out test patients the model never saw during training or tuning.",
    }


@app.get("/api/worklist")
def worklist(t: int | None = None):
    s = store()
    out = []
    t_replay = int(t) if t is not None else default_clock()
    for rec in s.query("SELECT * FROM recording ORDER BY mode DESC, rid"):
        tt = _resolve_t(rec, t_replay)
        state = _latest_state(rec["rid"], tt)
        status, since = _status(rec, tt, state)
        stats = _range_stats(rec["rid"], tt)
        risk = _risk(state if status == "monitoring" else None)
        tier, tier_name, reason = _priority(state, status, stats, risk)
        fc = None
        if state is not None and status == "monitoring":
            r60 = s.one("SELECT * FROM forecast WHERE rid=? AND issue_slot=? AND horizon=60", (rec["rid"], state["slot"]))
            if r60:
                fc = {"horizon": 60, "yhat": r60["yhat"], "lo": r60["lo"], "hi": r60["hi"]}
        out.append({
            "recording_id": rec["rid"], "mode": rec["mode"], "summary": json.loads(rec["summary_json"]),
            "clock": {"t": tt, "label": clock_label(tt)}, "status": status, "minutes_since_reading": since,
            "glucose": _f(state["glucose"]) if state is not None else None,
            "trend": trend_arrow(float(state["kf_slope"])) if state is not None and state["kf_slope"] is not None else None,
            "forecast_60": fc, "risk": risk, "stats_24h": stats,
            "priority": {"tier": tier, "name": tier_name, "reason": reason},
        })
    out.sort(key=lambda r: (r["priority"]["tier"], -(r["risk"]["hypo"]["p"] or 0), -(r["risk"]["hyper"]["p"] or 0)))
    return {"t": t_replay, "label": clock_label(t_replay), "patients": out}


@app.get("/api/patients/{rid}")
def patient(rid: str):
    rec = _rec(rid)
    return {"recording_id": rid, "mode": rec["mode"], "summary": json.loads(rec["summary_json"]),
            "fhir": json.loads(rec["fhir_json"]), "start_demo": rec["start_demo"], "end_demo": rec["end_demo"]}


@app.get("/api/patients/{rid}/twin")
def twin(rid: str, t: int | None = None, window_h: int = 24, horizon: int = 60):
    s = store()
    rec = _rec(rid)
    tt = _resolve_t(rec, t)
    lo_t = tt - window_h * 60
    state = _latest_state(rid, tt)
    status, since = _status(rec, tt, state)
    obs = s.query("SELECT demo_min t, glucose FROM observation WHERE rid=? AND demo_min>? AND demo_min<=? ORDER BY demo_min",
                  (rid, lo_t, tt))
    fs = s.query("SELECT demo_min t, glucose FROM fingerstick WHERE rid=? AND demo_min>? AND demo_min<=? ORDER BY demo_min",
                 (rid, lo_t, tt))
    ev = s.query("SELECT demo_min t, kind, detail, amount, unit, category FROM event WHERE rid=? AND demo_min>? AND demo_min<=? ORDER BY demo_min",
                 (rid, lo_t, tt))
    alerts = s.query("SELECT demo_min t, alert_hyper, alert_hyper2, alert_hypo FROM twin_state WHERE rid=? AND demo_min>? AND demo_min<=? "
                     "AND (alert_hyper=1 OR alert_hyper2=1 OR alert_hypo=1) ORDER BY demo_min", (rid, lo_t, tt))
    past = s.query(
        "SELECT issue_demo, target_demo, yhat, lo, hi, yhat_pop, CASE WHEN target_demo<=? THEN actual END actual "
        "FROM forecast WHERE rid=? AND horizon=? AND target_demo>? AND issue_demo<=? ORDER BY issue_demo",
        (tt, rid, horizon, lo_t, tt))
    body = {
        "recording_id": rid, "mode": rec["mode"], "summary": json.loads(rec["summary_json"]),
        "clock": {"t": tt, "label": clock_label(tt), "status": status, "minutes_since_reading": since,
                  "window_start": lo_t},
        "observations": [dict(r) for r in obs],
        "fingersticks": [dict(r) for r in fs],
        "events": [dict(r) for r in ev],
        "recent_alerts": [{"t": r["t"], "kinds": [k for k in EVENT_KINDS if r[f"alert_{k}"]]} for r in alerts],
        "past_forecasts": [{"issued_t": r["issue_demo"], "target_t": r["target_demo"], "yhat": r["yhat"],
                            "lo": r["lo"], "hi": r["hi"], "yhat_population": r["yhat_pop"], "actual": r["actual"]}
                           for r in past],
        "stats_24h": _range_stats(rid, tt),
        "state": None, "forecast": None, "abstain_reason": None,
        "disclaimer": DISCLAIMER,
    }
    if state is None or status != "monitoring":
        body["abstain_reason"] = {"not_started": "CGM wear has not started at this time",
                                  "warming_up": "Waiting for the first readings",
                                  "ended": "CGM wear has ended",
                                  "no_recent_data": "No reading in the last 30 min; forecasts are paused"}.get(status)
        return body
    slot = int(state["slot"])
    n_ok = s.one("SELECT COUNT(*) n FROM observation WHERE rid=? AND slot>? AND slot<=?", (rid, slot - 12, slot))["n"]
    body["state"] = {
        "slot": slot, "t": state["demo_min"], "glucose": _f(state["glucose"]),
        "kalman": {"level": _f(state["kf_level"]), "rate_mgdl_per_min": _f(state["kf_slope"]) / STEP_MIN if state["kf_slope"] is not None else None,
                   "level_sd": _f(state["kf_level_sd"])},
        "trend": trend_arrow(float(state["kf_slope"])),
        "profile": {"mean": _f(state["exp_mean"]), "sd": _f(state["exp_sd"]), "tar": _f(state["exp_tar"]), "tbr": _f(state["exp_tbr"])},
        "data_quality": {"readings_last_3h": n_ok, "expected_last_3h": 12, "issuable": bool(state["issuable"])},
        "personal_correction": {str(h): _f(state[f"bias_{h}"]) for h in HORIZONS_MIN},
    }
    if not state["issuable"]:
        body["abstain_reason"] = "Fewer than 8 readings in the last 3 h; forecasts are paused"
        return body
    fc = s.query("SELECT horizon, target_demo, yhat, lo, hi, yhat_pop FROM forecast WHERE rid=? AND issue_slot=? ORDER BY horizon",
                 (rid, slot))
    risk = _risk(state)
    feats = _features_for(rec, slot)
    drivers = {}
    if feats is not None:
        X = feats.to_frame().T.apply(pd.to_numeric, errors="coerce")
        b = s.bundle
        slot_ts = pd.Timestamp(state["ts"]) if state["ts"] else None
        drivers["forecast_60"] = _drivers(b.contributions(X, 60).iloc[0], feats, slot_ts)
        cand = [k for k in EVENT_KINDS if risk[k]["p"] is not None]
        if cand:
            kind = max(cand, key=lambda k: (risk[k]["p"] or 0) / b.thresholds[k])
            drivers["event"] = {"kind": kind, "items": _drivers(b.event_contributions(X, kind).iloc[0], feats, slot_ts),
                                "units": "log-odds"}
    body["forecast"] = {
        "issued_t": state["demo_min"],
        "horizons": [{"horizon": r["horizon"], "target_t": r["target_demo"], "yhat": r["yhat"], "lo": r["lo"],
                      "hi": r["hi"], "yhat_population": r["yhat_pop"], "primary": r["horizon"] in (30, 60)} for r in fc],
        "risk": risk,
        "active_alerts": [k for k in EVENT_KINDS if state[f"alert_{k}"]],
        "drivers": drivers,
    }
    return body


@app.get("/api/patients/{rid}/ledger")
def ledger(rid: str, t: int | None = None, horizon: int = 60, limit: int = 400):
    s = store()
    rec = _rec(rid)
    tt = _resolve_t(rec, t)
    rows = s.query(
        "SELECT f.issue_demo, f.target_demo, f.yhat, f.yhat_pop, f.lo, f.hi, f.actual, o.glucose g0 "
        "FROM forecast f LEFT JOIN observation o ON o.rid=f.rid AND o.slot=f.issue_slot "
        "WHERE f.rid=? AND f.horizon=? AND f.target_demo<=? AND f.actual IS NOT NULL ORDER BY f.issue_demo",
        (rid, horizon, tt))
    pending = s.one("SELECT COUNT(*) n FROM forecast WHERE rid=? AND horizon=? AND issue_demo<=? AND target_demo>?",
                    (rid, horizon, tt, tt))["n"]
    if not rows:
        return {"recording_id": rid, "horizon": horizon, "t": tt, "summary": {"n_resolved": 0, "pending": pending},
                "by_day": [], "entries": []}
    df = pd.DataFrame([dict(r) for r in rows])
    err = df["yhat"] - df["actual"]
    summary = {
        "n_resolved": int(len(df)), "pending": int(pending),
        "mae": float(err.abs().mean()), "bias": float(err.mean()),
        "mae_population_model": float((df["yhat_pop"] - df["actual"]).abs().mean()),
        "mae_persistence": float((df["g0"] - df["actual"]).abs().mean()),
        "coverage": float(((df["actual"] >= df["lo"]) & (df["actual"] <= df["hi"])).mean()),
        "nominal_coverage": 0.8,
    }
    df["day"] = df["issue_demo"] // 1440 + 1
    by_day = []
    for day, g in df.groupby("day"):
        e = g["yhat"] - g["actual"]
        by_day.append({"day": int(day), "n": int(len(g)), "mae": float(e.abs().mean()),
                       "mae_persistence": float((g["g0"] - g["actual"]).abs().mean()),
                       "coverage": float(((g["actual"] >= g["lo"]) & (g["actual"] <= g["hi"])).mean())})
    entries = df.tail(limit)
    return {
        "recording_id": rid, "horizon": horizon, "t": tt, "summary": summary, "by_day": by_day,
        "entries": [{"issued_t": int(r.issue_demo), "target_t": int(r.target_demo), "yhat": r.yhat, "lo": r.lo, "hi": r.hi,
                     "actual": r.actual, "error": r.yhat - r.actual, "inside": bool(r.lo <= r.actual <= r.hi),
                     "glucose_at_issue": _f(r.g0)} for r in entries.itertuples()],
    }


class Change(BaseModel):
    kind: str = Field(description="add_meal | remove_recent_meals | add_fast_insulin | remove_recent_insulin")
    grams: float | None = None
    carb_grams: float | None = None
    units: float | None = None


class SensitivityRequest(BaseModel):
    t: int | None = None
    changes: list[Change]


@app.post("/api/patients/{rid}/sensitivity")
def sensitivity(rid: str, req: SensitivityRequest):
    s = store()
    rec = _rec(rid)
    if rec["mode"] != "replay":
        raise HTTPException(400, "Sensitivity analysis is available for replay patients")
    tt = _resolve_t(rec, req.t)
    state = _latest_state(rid, tt)
    if state is None or not state["issuable"] or _status(rec, tt, state)[0] != "monitoring":
        raise HTTPException(409, "No forecast is available at this time")
    slot = int(state["slot"])
    base_series = s.series[rid].truncate(slot)
    mod = copy.deepcopy(base_series)
    window = 12
    applied = []
    for ch in req.changes:
        if ch.kind == "add_meal":
            grams = float(ch.grams or 300)
            carb = float(ch.carb_grams if ch.carb_grams is not None else grams * 0.35)
            mod.meal[slot] = 1
            mod.meal_grams[slot] = np.nansum([mod.meal_grams[slot], grams])
            mod.meal_carb[slot] = np.nansum([mod.meal_carb[slot], carb])
            applied.append(f"Added a {grams:.0f} g meal ({carb:.0f} g carbohydrate-dense food) now")
        elif ch.kind == "remove_recent_meals":
            lo = max(0, slot - window + 1)
            n = int(mod.meal[lo:].sum())
            mod.meal[lo:] = 0
            mod.meal_grams[lo:] = np.nan
            mod.meal_carb[lo:] = np.nan
            applied.append(f"Removed {n} meal log(s) from the last 3 h")
        elif ch.kind == "add_fast_insulin":
            u = float(ch.units or 4)
            mod.fast_units[slot] += u
            applied.append(f"Added {u:.0f} IU fast-acting insulin now")
        elif ch.kind == "remove_recent_insulin":
            lo = max(0, slot - 16 + 1)
            u = float(mod.fast_units[lo:].sum())
            mod.fast_units[lo:] = 0
            applied.append(f"Removed {u:.0f} IU fast-acting insulin from the last 4 h")
        else:
            raise HTTPException(422, f"Unsupported change '{ch.kind}'")
    b = s.bundle
    f0 = s.features[rid].iloc[[slot]]
    f1 = build_features(mod, b.kalman).iloc[[slot]]
    p0, p1 = b.predict(f0), b.predict(f1)
    ranges = json.loads((MODELS_DIR / "feature_ranges.json").read_text())
    changed, ood = [], []
    for f in b.features:
        a, c = _f(f0[f].iloc[0]), _f(f1[f].iloc[0])
        if a != c and not (a is None and c is None):
            changed.append({"feature": f, "label": FEATURE_LABELS.get(f, f), "before": _format_value(f, a), "after": _format_value(f, c)})
            r = ranges.get(f)
            if r and c is not None and (c < r[0] or c > r[1]):
                ood.append(f"{FEATURE_LABELS.get(f, f)} = {_format_value(f, c)} is outside the central 98% of training data")
    def pack(p):
        return {"horizons": [{"horizon": h, "yhat": float(p[f"yhat_{h}"][0] + (state[f"bias_{h}"] or 0)),
                              "lo": float(p[f"lo_{h}"][0] + (state[f"bias_{h}"] or 0)),
                              "hi": float(p[f"hi_{h}"][0] + (state[f"bias_{h}"] or 0))} for h in HORIZONS_MIN],
                "risk": {k: (float(p[f"p_{k}"][0]) if at_risk(k, float(state["glucose"])) else None) for k in EVENT_KINDS}}
    return {
        "t": tt, "label": clock_label(tt), "applied": applied, "baseline": pack(p0), "scenario": pack(p1),
        "changed_features": changed, "ood_warnings": ood,
        "disclaimer": ("This shows how the trained model's output changes when one logged input is changed. "
                       "The model learned associations from observational data, so this is not an estimate of the "
                       "causal effect of eating or dosing, and it must not guide treatment."),
    }


@app.get("/api/evaluation")
def evaluation():
    path = RESULTS_DIR / "benchmark.json"
    if not path.exists():
        raise HTTPException(404, "Run `python -m pratirup.cli report` to generate results/benchmark.json")
    return json.loads(path.read_text())


# ---------------------------------------------------------------------------
# live streaming


class LiveSession:
    def __init__(self, rid: str, source: str, twin: LiveTwin):
        self.rid, self.source, self.twin = rid, source, twin
        self.lock = threading.RLock()
        self.thread: threading.Thread | None = None
        self.stop = threading.Event()
        self.ingested = 0
        self.alerts = 0
        self.started_at = time.time()


LIVE: dict[str, LiveSession] = {}


def _write_update(sess: LiveSession, upd, ts: pd.Timestamp) -> None:
    s = store()
    dm = int(demo_minutes(sess.twin.t0, [ts])[0])
    st = upd.state
    row = {c: None for c in STATE_COLS}
    row.update({"rid": sess.rid, "slot": upd.slot, "demo_min": dm, "ts": str(ts)})
    for k, v in st.items():
        if k in row:
            row[k] = (int(v) if isinstance(v, (bool, np.bool_)) else _none(v))
    s.execute(f"INSERT OR REPLACE INTO twin_state VALUES ({','.join('?' * len(STATE_COLS))})",
              tuple(row[c] for c in STATE_COLS))
    s.execute("INSERT OR REPLACE INTO observation VALUES (?,?,?,?,?)", (sess.rid, upd.slot, dm, str(ts), float(st["glucose"])))
    rows = []
    for f in upd.forecasts:
        tts = sess.twin.t0 + pd.Timedelta(minutes=f["target_slot"] * STEP_MIN)
        rows.append((sess.rid, f["issue_slot"], f["horizon"], f["target_slot"], dm, int(demo_minutes(sess.twin.t0, [tts])[0]),
                     f["yhat_pop"], f["yhat"], f["lo"], f["hi"], None))
    if rows:
        s.execute_many("INSERT OR REPLACE INTO forecast VALUES (?,?,?,?,?,?,?,?,?,?,?)", rows)
    for r in upd.resolved:
        s.execute("UPDATE forecast SET actual=? WHERE rid=? AND issue_slot=? AND horizon=?",
                  (r["actual"], sess.rid, r["issue_slot"], r["horizon"]))
    sess.ingested += 1
    sess.alerts += len(upd.alerts)


def _ingest_event_row(sess: LiveSession, e) -> None:
    ts = sess.twin.t0 + pd.Timedelta(minutes=int(e.slot) * STEP_MIN)
    kw = {k: getattr(e, k) for k in ("grams", "carb_grams", "fast_units", "basal_units", "rate", "secretagogue", "agi", "biguanide")
          if hasattr(e, k) and pd.notna(getattr(e, k))}
    sess.twin.ingest_event(ts, e.kind, **kw)
    amount, unit = None, None
    if e.kind == "meal" and pd.notna(e.grams):
        amount, unit = float(e.grams), "g"
    elif e.kind in ("insulin", "csii_bolus", "insulin_iv") and pd.notna(e.units):
        amount, unit = float(e.units), "IU"
    elif e.kind == "csii_basal_rate":
        amount, unit = float(e.rate), "IU/h"
    store().execute("INSERT INTO event VALUES (?,?,?,?,?,?,?,?,?)",
                    (sess.rid, int(e.slot), int(demo_minutes(sess.twin.t0, [ts])[0]), str(ts), e.kind, e.detail, amount, unit,
                     e.category if isinstance(getattr(e, "category", None), str) else None))


def _stream(sess: LiveSession, seconds_per_reading: float) -> None:
    s = store()
    cgm = s.tables["cgm"]
    cgm = cgm[cgm["recording_id"] == sess.source].sort_values("slot")
    ev = s.tables["events"]
    ev = ev[ev["recording_id"] == sess.source].sort_values("slot")
    ev_by_slot = {k: g for k, g in ev.groupby("slot")}
    done_ev = set()
    for r in cgm.itertuples():
        if sess.stop.is_set():
            break
        with sess.lock:
            for slot in sorted(k for k in ev_by_slot if k <= r.slot and k not in done_ev):
                for e in ev_by_slot[slot].itertuples():
                    _ingest_event_row(sess, e)
                done_ev.add(slot)
            ts = sess.twin.t0 + pd.Timedelta(minutes=int(r.slot) * STEP_MIN)
            upd = sess.twin.ingest_reading(ts, float(r.glucose))
            _write_update(sess, upd, ts)
        time.sleep(seconds_per_reading)


class LiveStart(BaseModel):
    source_recording_id: str | None = None
    seconds_per_reading: float = 1.0
    external: bool = False


def _live_summary(sess: LiveSession) -> dict:
    return {"recording_id": sess.rid, "source": sess.source, "running": bool(sess.thread and sess.thread.is_alive()),
            "external": sess.thread is None, "ingested_readings": sess.ingested, "alerts": sess.alerts}


@app.post("/api/live/start")
def live_start(req: LiveStart):
    s = store()
    src = req.source_recording_id or s.replay_recordings()["recording_id"].iloc[0]
    recs = s.tables["recordings"]
    row = recs[recs["recording_id"] == src]
    if row.empty:
        raise HTTPException(404, f"Unknown source recording '{src}'")
    rec = row.iloc[0]
    rid = f"LIVE-{src}"
    old = LIVE.pop(rid, None)
    if old:
        old.stop.set()
        if old.thread:
            old.thread.join(timeout=5)
    for t in ("observation", "event", "twin_state", "forecast", "recording"):
        s.execute(f"DELETE FROM {t} WHERE rid=?", (rid,))
    from pratirup.features import STATIC_FEATURES
    from pratirup.api.store import recording_summary
    from pratirup.data.fhir import record_to_bundle
    t0 = pd.Timestamp(rec["start_ts"])
    summary = recording_summary(rec)
    summary["display_id"] = "LIVE · " + summary["display_id"]
    summary["source"] = "Streamed one reading at a time from a held-out ShanghaiT2DM recording"
    s.execute("INSERT INTO recording VALUES (?,?,?,?,?,?,?,?,?,?)",
              (rid, rec["patient_id"], "live", src, json.dumps(summary, default=str), json.dumps(record_to_bundle(rec), default=str),
               str(t0), int(demo_minutes(t0, [t0])[0]), int(demo_minutes(t0, [t0])[0]), 0))
    twin_obj = LiveTwin(rid, rec["patient_id"], t0, {k: rec.get(k) for k in STATIC_FEATURES}, s.bundle)
    sess = LiveSession(rid, src, twin_obj)
    LIVE[rid] = sess
    if not req.external:
        sess.thread = threading.Thread(target=_stream, args=(sess, max(0.05, req.seconds_per_reading)), daemon=True)
        sess.thread.start()
    return _live_summary(sess)


@app.post("/api/live/{rid}/stop")
def live_stop(rid: str):
    sess = LIVE.get(rid)
    if not sess:
        raise HTTPException(404, "No such live session")
    sess.stop.set()
    if sess.thread:
        sess.thread.join(timeout=5)
    return _live_summary(sess)


@app.get("/api/live")
def live_list():
    return {"sessions": [_live_summary(x) for x in LIVE.values()]}


class Reading(BaseModel):
    ts: str
    glucose: float = Field(ge=20, le=600)


class EventIn(BaseModel):
    ts: str
    kind: str
    detail: str = ""
    grams: float | None = None
    carb_grams: float | None = None
    units: float | None = None
    insulin_name: str | None = None
    oral_text: str | None = None
    rate: float | None = None


@app.post("/api/live/{rid}/readings")
def live_reading(rid: str, r: Reading):
    sess = LIVE.get(rid)
    if not sess:
        raise HTTPException(404, "No such live session; POST /api/live/start with external=true first")
    ts = pd.Timestamp(r.ts)
    with sess.lock:
        try:
            upd = sess.twin.ingest_reading(ts, r.glucose)
        except ValueError as exc:
            raise HTTPException(409, str(exc))
        _write_update(sess, upd, ts)
    return {"slot": upd.slot, "alerts": upd.alerts, "forecasts": upd.forecasts, "abstain_reason": upd.abstain_reason,
            "resolved": upd.resolved}


@app.post("/api/live/{rid}/events")
def live_event(rid: str, e: EventIn):
    sess = LIVE.get(rid)
    if not sess:
        raise HTTPException(404, "No such live session")
    ts = pd.Timestamp(e.ts)
    kw: dict = {}
    if e.kind == "meal":
        meal = vocab.parse_diet(e.detail) if e.detail else None
        kw = {"grams": e.grams if e.grams is not None else (meal.total_grams if meal else None),
              "carb_grams": e.carb_grams if e.carb_grams is not None else (meal.carb_dense_grams if meal else None)}
    elif e.kind == "insulin":
        doses = vocab.parse_insulin(f"{e.insulin_name or 'insulin'}, {e.units or 0} IU")
        kw = {"fast_units": sum(d.fast_units for d in doses), "basal_units": sum(d.basal_units for d in doses)}
    elif e.kind == "oral":
        cls = vocab.oral_classes(e.oral_text or e.detail)
        kw = {"secretagogue": int(any(c in cls for c in vocab.SECRETAGOGUES)), "agi": int("agi" in cls),
              "biguanide": int("biguanide" in cls)}
    elif e.kind == "csii_basal_rate":
        kw = {"rate": e.rate}
    with sess.lock:
        try:
            slot = sess.twin.ingest_event(ts, e.kind, **kw)
        except ValueError as exc:
            raise HTTPException(409, str(exc))
    store().execute("INSERT INTO event VALUES (?,?,?,?,?,?,?,?,?)",
                    (rid, slot, int(demo_minutes(sess.twin.t0, [ts])[0]), str(ts), e.kind, e.detail or e.kind,
                     e.grams or e.units or e.rate, None, None))
    return {"slot": slot}


# ---------------------------------------------------------------------------
# static frontend

_DIST = ROOT / "web" / "dist"
if _DIST.exists():
    app.mount("/assets", StaticFiles(directory=_DIST / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str):
        target = _DIST / path
        if path and target.is_file():
            return FileResponse(target)
        return FileResponse(_DIST / "index.html")
