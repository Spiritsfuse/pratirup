"""Consolidated alert policy (v2).

v1 ran three independent alert streams (>180, >250, <70), each tuned for
<= 2 false alerts per patient-day, which added up to ~8 alerts per
patient-day on test patients: unusable for a care team.

v2 policy, a product decision grounded in the time-in-range consensus:
  * Interruptive alerts only for predicted hypoglycaemia (< 70 mg/dL) and
    predicted level-2 hyperglycaemia (> 250 mg/dL). Time above 180 is expected
    in T2D (consensus target < 25%, not zero), so ">180 within 60 min" stays a
    ranking signal on the worklist, not an interruption.
  * One stream per patient with a shared 60-min cooldown; a hypoglycaemia
    alert may break through a cooldown started by a hyperglycaemia alert.
  * Thresholds chosen on development patients only, to maximise
    (2 x hypo sensitivity + hyper-250 sensitivity) subject to <= 1 false alert
    per patient-day in total.
"""

from __future__ import annotations

import numpy as np

from pratirup.config import ALERT_REFRACTORY_MIN, EVENT_WINDOW_MIN, SLOTS_PER_DAY, STEP_MIN

ALERT_KINDS = ("hypo", "hyper2")      # priority order
PRIORITY_WEIGHT = {"hypo": 2.0, "hyper2": 1.0}
TOTAL_FALSE_ALERT_BUDGET = 1.0        # per patient-day


def run_policy(slots: np.ndarray, p: dict[str, np.ndarray], thr: dict[str, float]) -> list[tuple[int, str]]:
    """Return fired alerts [(slot, kind)] in time order. p[kind] is NaN when not at risk."""
    refr = ALERT_REFRACTORY_MIN // STEP_MIN
    fired: list[tuple[int, str]] = []
    last_any, last_kind = -10**9, None
    for i in np.argsort(slots):
        s = int(slots[i])
        for kind in ALERT_KINDS:
            v = p[kind][i]
            if not np.isfinite(v) or v < thr[kind]:
                continue
            in_cooldown = s - last_any < refr
            breakthrough = kind == "hypo" and last_kind == "hyper2"
            if in_cooldown and not breakthrough:
                break
            fired.append((s, kind))
            last_any, last_kind = s, kind
            break
    return fired


def evaluate_policy(records: list[dict], thr: dict[str, float]) -> dict:
    """records: dicts with slots, p (dict kind->array), onsets (dict kind->array), n_readings."""
    window = EVENT_WINDOW_MIN // STEP_MIN
    days = sum(r["n_readings"] for r in records) / SLOTS_PER_DAY
    out = {k: {"episodes": 0, "detected": 0, "detected_lead30": 0, "leads": []} for k in ALERT_KINDS}
    n_alerts = n_false = 0
    for r in records:
        alerts = run_policy(r["slots"], r["p"], thr)
        n_alerts += len(alerts)
        for s, kind in alerts:
            on = r["onsets"][kind]
            if not np.any((on > s) & (on <= s + window)):
                n_false += 1
        for kind in ALERT_KINDS:
            a = np.array([s for s, k in alerts if k == kind], dtype=int)
            for o in r["onsets"][kind]:
                if not np.any((r["slots"] >= o - window) & (r["slots"] < o)):
                    continue
                out[kind]["episodes"] += 1
                prior = a[(a >= o - window) & (a < o)] if len(a) else a
                if len(prior):
                    lead = (o - prior.min()) * STEP_MIN
                    out[kind]["detected"] += 1
                    out[kind]["detected_lead30"] += int(lead >= 30)
                    out[kind]["leads"].append(float(lead))
    res = {"thresholds": {k: float(v) for k, v in thr.items()}, "patient_days": float(days),
           "alerts_per_day": n_alerts / days if days else None,
           "false_alerts_per_day": n_false / days if days else None,
           "ppv": (n_alerts - n_false) / n_alerts if n_alerts else None}
    for k, v in out.items():
        res[k] = {"episodes": v["episodes"],
                  "sensitivity": v["detected"] / v["episodes"] if v["episodes"] else None,
                  "sensitivity_lead30": v["detected_lead30"] / v["episodes"] if v["episodes"] else None,
                  "lead_time_median_min": float(np.median(v["leads"])) if v["leads"] else None}
    return res


def choose_thresholds(records: list[dict], budget: float = TOTAL_FALSE_ALERT_BUDGET) -> tuple[dict, dict]:
    """Grid search on development data only."""
    pool = {k: np.concatenate([r["p"][k][np.isfinite(r["p"][k])] for r in records]) for k in ALERT_KINDS}
    grids = {k: np.unique(np.quantile(pool[k], np.linspace(0.90, 0.9995, 24))) for k in ALERT_KINDS}
    best, best_res, best_score = None, None, -1.0
    for th in grids["hypo"]:
        for t2 in grids["hyper2"]:
            thr = {"hypo": float(th), "hyper2": float(t2)}
            res = evaluate_policy(records, thr)
            if res["false_alerts_per_day"] is None or res["false_alerts_per_day"] > budget:
                continue
            score = sum(PRIORITY_WEIGHT[k] * (res[k]["sensitivity"] or 0) for k in ALERT_KINDS)
            if score > best_score:
                best, best_res, best_score = thr, res, score
    return best, best_res
