"""Evaluation metrics.

Forecast: MAE, RMSE, bias, error by glucose band, Parkes (Consensus) Error
Grid for type 2 diabetes, prediction-interval coverage and width.

Events: sample-level AUPRC / AUROC / Brier, and event-level alerting with a
refractory period, which is what a care team would experience: sensitivity
per excursion episode, positive predictive value per alert, false alerts per
patient-day, and lead time.
"""

from __future__ import annotations

import numpy as np
import pandas as pd
from matplotlib.path import Path as MplPath
from sklearn.metrics import average_precision_score, brier_score_loss, roc_auc_score

from pratirup.config import (
    ALERT_REFRACTORY_MIN, BOOTSTRAP_ITERS, EVENT_CONSECUTIVE, EVENT_WINDOW_MIN, HYPER, HYPO,
    SEED, SLOTS_PER_DAY, STEP_MIN,
)

# ---------------------------------------------------------------------------
# Forecast accuracy


def point_metrics(y: np.ndarray, yhat: np.ndarray) -> dict:
    e = yhat - y
    return {
        "n": int(len(y)),
        "mae": float(np.mean(np.abs(e))),
        "rmse": float(np.sqrt(np.mean(e ** 2))),
        "bias": float(np.mean(e)),
        "mard_pct": float(np.mean(np.abs(e) / y) * 100),
    }


def band_mae(y: np.ndarray, yhat: np.ndarray) -> dict:
    out = {}
    for name, lo, hi in (("below_70", -np.inf, HYPO), ("70_180", HYPO, HYPER + 1e-9), ("above_180", HYPER + 1e-9, np.inf)):
        m = (y >= lo) & (y < hi)
        out[name] = {"n": int(m.sum()), "mae": float(np.mean(np.abs(yhat[m] - y[m]))) if m.any() else None}
    return out


# Parkes (Consensus) Error Grid, type 2 diabetes. Zone vertices from
# Parkes et al., Diabetes Care 2000 and Pfutzner et al., J Diabetes Sci
# Technol 2013, as implemented in the R package `ega` (getParkesZones, type=2).
def _coef(x, y, xe, ye):
    return (ye - y) / (xe - x)


def _endx(sx, sy, maxy, c):
    return (maxy - sy) / c + sx


def _endy(sx, sy, maxx, c):
    return (maxx - sx) * c + sy


def parkes_zones_type2(ref: np.ndarray, test: np.ndarray) -> np.ndarray:
    ref = np.asarray(ref, float)
    test = np.asarray(test, float)
    maxX = max(ref.max() + 20, 550)
    maxY = max((test + 20).max(), maxX, 550)
    ce, cdu, cdl = _coef(35, 200, 50, 550), _coef(35, 90, 125, 550), _coef(410, 110, 550, 160)
    ccu, ccl = _coef(30, 60, 280, 550), _coef(260, 130, 550, 250)
    cbu, cbl = _coef(230, 330, 440, 550), _coef(330, 230, 550, 450)
    polys = {
        "B_lower": [(50, 0), (50, 30), (90, 80), (330, 230), (maxX, _endy(330, 230, maxX, cbl)), (maxX, 0)],
        "B_upper": [(0, 50), (30, 50), (230, 330), (_endx(230, 330, maxY, cbu), maxY), (0, maxY)],
        "C_lower": [(90, 0), (260, 130), (maxX, _endy(260, 130, maxX, ccl)), (maxX, 0)],
        "C_upper": [(0, 60), (30, 60), (_endx(30, 60, maxY, ccu), maxY), (0, maxY)],
        "D_lower": [(250, 0), (250, 40), (410, 110), (maxX, _endy(410, 110, maxX, cdl)), (maxX, 0)],
        "D_upper": [(0, 80), (25, 80), (35, 90), (_endx(35, 90, maxY, cdu), maxY), (0, maxY)],
        "E_upper": [(0, 200), (35, 200), (_endx(35, 200, maxY, ce), maxY), (0, maxY)],
    }
    pts = np.column_stack([ref, test])
    zones = np.full(len(ref), "A", dtype="<U1")
    for key in ("B_lower", "B_upper", "C_lower", "C_upper", "D_lower", "D_upper", "E_upper"):
        inside = MplPath(polys[key] + [polys[key][0]]).contains_points(pts)
        zones[inside] = key[0]
    return zones


def parkes_summary(ref: np.ndarray, test: np.ndarray) -> dict:
    z = parkes_zones_type2(ref, test)
    out = {k: float(np.mean(z == k) * 100) for k in "ABCDE"}
    out["A+B"] = out["A"] + out["B"]
    return out


def interval_metrics(y: np.ndarray, lo: np.ndarray, hi: np.ndarray) -> dict:
    inside = (y >= lo) & (y <= hi)
    return {
        "coverage": float(inside.mean()),
        "mean_width": float(np.mean(hi - lo)),
        "median_width": float(np.median(hi - lo)),
    }


# ---------------------------------------------------------------------------
# Event detection


def sample_event_metrics(y: np.ndarray, score: np.ndarray) -> dict:
    m = np.isfinite(y) & np.isfinite(score)
    y, score = y[m].astype(int), score[m]
    out = {"n": int(len(y)), "prevalence": float(y.mean())}
    if 0 < y.sum() < len(y):
        out["auprc"] = float(average_precision_score(y, score))
        out["auroc"] = float(roc_auc_score(y, score))
        if score.min() >= 0 and score.max() <= 1:
            out["brier"] = float(brier_score_loss(y, score))
    return out


def episode_onsets(g: np.ndarray, kind: str) -> np.ndarray:
    """Slots where an excursion starts: >= EVENT_CONSECUTIVE consecutive readings
    beyond the threshold, preceded by a reading on the safe side."""
    if kind == "hyper":
        beyond = g > HYPER
        safe = g <= HYPER
    elif kind == "hyper2":
        beyond = g > 250
        safe = g <= 250
    else:
        beyond = g < HYPO
        safe = g >= HYPO
    beyond = np.where(np.isfinite(g), beyond, False)
    safe = np.where(np.isfinite(g), safe, False)
    k = EVENT_CONSECUTIVE
    onsets = []
    for o in range(1, len(g) - k + 1):
        if safe[o - 1] and beyond[o : o + k].all():
            onsets.append(o)
    return np.array(onsets, dtype=int)


def alert_slots(slots: np.ndarray, score: np.ndarray, threshold: float) -> np.ndarray:
    """Alerts fire when score >= threshold, then stay silent for the refractory period."""
    refractory = ALERT_REFRACTORY_MIN // STEP_MIN
    order = np.argsort(slots)
    fired, last = [], -10**9
    for i in order:
        if score[i] >= threshold and slots[i] - last >= refractory:
            fired.append(slots[i])
            last = slots[i]
    return np.array(fired, dtype=int)


def event_level(per_recording: list[dict], threshold: float) -> dict:
    """per_recording: dicts with keys slots, score, onsets, n_readings."""
    window = EVENT_WINDOW_MIN // STEP_MIN
    tp_alerts = fp_alerts = n_alerts = detected = n_episodes = 0
    leads: list[float] = []
    days = 0.0
    for r in per_recording:
        alerts = alert_slots(r["slots"], r["score"], threshold)
        onsets = r["onsets"]
        # Only score episodes the model had a chance to anticipate: at least one
        # at-risk issue time in the hour before onset.
        eligible = [o for o in onsets if np.any((r["slots"] >= o - window) & (r["slots"] < o))]
        n_episodes += len(eligible)
        days += r["n_readings"] / SLOTS_PER_DAY
        n_alerts += len(alerts)
        for a in alerts:
            if np.any((onsets > a) & (onsets <= a + window)):
                tp_alerts += 1
            else:
                fp_alerts += 1
        for o in eligible:
            prior = alerts[(alerts >= o - window) & (alerts < o)]
            if len(prior):
                detected += 1
                leads.append(float((o - prior.min()) * STEP_MIN))
    return {
        "threshold": float(threshold),
        "episodes": int(n_episodes),
        "detected": int(detected),
        "sensitivity": detected / n_episodes if n_episodes else None,
        "alerts": int(n_alerts),
        "ppv": tp_alerts / n_alerts if n_alerts else None,
        "false_alerts_per_day": fp_alerts / days if days else None,
        "alerts_per_day": n_alerts / days if days else None,
        "sensitivity_lead30": (sum(l >= 30 for l in leads) / n_episodes) if n_episodes else None,
        "lead_time_median_min": float(np.median(leads)) if leads else None,
        "lead_time_iqr_min": [float(np.percentile(leads, 25)), float(np.percentile(leads, 75))] if leads else None,
        "patient_days": float(days),
    }


def threshold_for_budget(per_recording: list[dict], budget_per_day: float, grid: np.ndarray) -> float:
    """Most sensitive threshold whose false-alert rate stays within budget."""
    best = float(grid.max())
    for t in sorted(grid, reverse=True):
        res = event_level(per_recording, t)
        if res["false_alerts_per_day"] is not None and res["false_alerts_per_day"] <= budget_per_day:
            best = float(t)
        else:
            break
    return best


def calibration_bins(y: np.ndarray, p: np.ndarray, n_bins: int = 10) -> list[dict]:
    m = np.isfinite(y) & np.isfinite(p)
    y, p = y[m], p[m]
    edges = np.quantile(p, np.linspace(0, 1, n_bins + 1))
    edges = np.unique(edges)
    out = []
    for lo, hi in zip(edges[:-1], edges[1:]):
        sel = (p >= lo) & (p <= hi) if hi == edges[-1] else (p >= lo) & (p < hi)
        if sel.sum():
            out.append({"p_mean": float(p[sel].mean()), "observed": float(y[sel].mean()), "n": int(sel.sum())})
    return out


# ---------------------------------------------------------------------------
# Uncertainty of results: patient-level bootstrap


def bootstrap_mae_diff(df: pd.DataFrame, a: str, b: str, iters: int = BOOTSTRAP_ITERS) -> dict:
    """Difference MAE(a) - MAE(b), resampling patients. df columns: patient_id, y, a, b."""
    g = df.assign(ea=np.abs(df[a] - df["y"]), eb=np.abs(df[b] - df["y"])).groupby("patient_id")
    sums = g[["ea", "eb"]].sum()
    counts = g.size()
    rng = np.random.default_rng(SEED)
    pids = sums.index.to_numpy()
    diffs = np.empty(iters)
    for i in range(iters):
        pick = rng.choice(pids, size=len(pids), replace=True)
        n = counts.loc[pick].sum()
        diffs[i] = (sums.loc[pick, "ea"].sum() - sums.loc[pick, "eb"].sum()) / n
    point = (sums["ea"].sum() - sums["eb"].sum()) / counts.sum()
    return {
        "diff": float(point),
        "ci95": [float(np.percentile(diffs, 2.5)), float(np.percentile(diffs, 97.5))],
        "p_a_better": float(np.mean(diffs < 0)),
    }
