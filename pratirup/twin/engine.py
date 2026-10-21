"""The digital twin engine.

A twin is the per-patient state that is updated every time a CGM reading or a
logged event arrives:

  clinical context  - the linked clinical record (static until a new record)
  glycaemic state   - Kalman level, rate and their uncertainty
  event context     - recent meals, insulin, oral agents, pump rate
  personal profile  - expanding time-in-range statistics, time-of-day history
  model trust       - running mean of this patient's own forecast errors
  data quality      - readings in the last 3 h, abstention

Two implementations share every formula:

  replay_outputs()  vectorised; used to precompute the replay timeline
  LiveTwin          one reading at a time; used for streamed data

tests/test_twin_parity.py requires them to produce identical numbers.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field

import numpy as np
import pandas as pd

from pratirup.config import ALERT_REFRACTORY_MIN, HORIZONS_MIN, HYPER, HYPER_L2, HYPO, STEP_MIN, horizon_slots
from pratirup.features import Series, build_features
from pratirup.models.bundle import EVENT_KINDS, ModelBundle
from pratirup.twin import kalman as K
from pratirup.evaluation.alerts import ALERT_KINDS, run_policy

REFRACTORY_SLOTS = ALERT_REFRACTORY_MIN // STEP_MIN
STATE_COLUMNS = [
    "glucose", "kf_level", "kf_slope", "kf_level_sd", "exp_mean", "exp_sd", "exp_tar", "exp_tbr",
    "n_missing_3h", "issuable",
]


def at_risk(kind: str, g0: float) -> bool:
    if kind == "hyper":
        return g0 <= HYPER
    if kind == "hyper2":
        return g0 <= HYPER_L2
    return g0 >= HYPO


class EWM:
    """Recursive form of pandas ewm(halflife, adjust=True, ignore_na=True).mean()."""

    def __init__(self, halflife: float):
        self.decay = math.exp(math.log(0.5) / halflife)
        self.num = 0.0
        self.den = 0.0
        self.n = 0

    def update(self, x: float) -> None:
        self.num = self.decay * self.num + x
        self.den = self.decay * self.den + 1.0
        self.n += 1

    @property
    def value(self) -> float:
        return self.num / self.den if self.den > 0 else 0.0


def demo_minutes(t0: pd.Timestamp, ts: pd.DatetimeIndex | pd.Series) -> np.ndarray:
    """Minutes on a shared demo clock: wear-day index * 1440 + minute of day.

    Recordings come from different calendar dates. Aligning them on wear day
    and clock time lets a worklist show every patient at the same moment
    while keeping each patient's true time of day.
    """
    ts = pd.DatetimeIndex(ts)
    day = (ts.normalize() - t0.normalize()).days.to_numpy()
    return day * 1440 + ts.hour.to_numpy() * 60 + ts.minute.to_numpy()


@dataclass
class ReplayOutputs:
    features: pd.DataFrame       # one row per slot
    state: pd.DataFrame          # one row per slot
    forecasts: pd.DataFrame      # one row per issued forecast x horizon


def _sequential_alerts(slots: np.ndarray, p: np.ndarray, thr: float) -> np.ndarray:
    fired = np.zeros(len(slots), dtype=bool)
    last = -10**9
    for i in range(len(slots)):
        if np.isfinite(p[i]) and p[i] >= thr and slots[i] - last >= REFRACTORY_SLOTS:
            fired[i] = True
            last = slots[i]
    return fired


def replay_outputs(s: Series, bundle: ModelBundle) -> ReplayOutputs:
    feats = build_features(s, bundle.kalman)
    times = s.slot_times()
    state = feats[["slot"] + [c for c in STATE_COLUMNS if c in feats.columns and c != "glucose"]].copy()
    state["glucose"] = s.glucose
    state["ts"] = times
    state["demo_min"] = demo_minutes(s.t0, times)
    iss = feats[feats["issuable"]]
    slots = iss["slot"].to_numpy()
    pred = bundle.predict(iss)

    rows = []
    for h in HORIZONS_MIN:
        hs = horizon_slots(h)
        tgt_slot = slots + hs
        actual = np.where(tgt_slot < s.n, s.glucose[np.minimum(tgt_slot, s.n - 1)], np.nan)
        yhat_pop = pred[f"yhat_{h}"]
        r = np.full(s.n + hs, np.nan)
        ok = np.isfinite(actual)
        r[slots[ok]] = actual[ok] - yhat_pop[ok]
        ew = pd.Series(r).ewm(halflife=bundle.personal[h]["halflife"], ignore_na=True, min_periods=1).mean()
        bias = np.nan_to_num(ew.shift(hs).to_numpy()[slots], nan=0.0) * bundle.personal[h]["lambda"]
        state.loc[slots, f"bias_{h}"] = bias
        rows.append(pd.DataFrame({
            "issue_slot": slots, "horizon": h, "target_slot": tgt_slot,
            "yhat_pop": yhat_pop, "yhat": yhat_pop + bias,
            "lo": pred[f"lo_{h}"] + bias, "hi": pred[f"hi_{h}"] + bias, "actual": actual,
        }))
    g0 = iss["g0"].to_numpy()
    for kind in EVENT_KINDS:
        p = np.where([at_risk(kind, x) for x in g0], pred[f"p_{kind}"], np.nan)
        state.loc[slots, f"p_{kind}"] = p
        state.loc[slots, f"alert_{kind}"] = _sequential_alerts(slots, p, bundle.thresholds[kind])
    for kind in EVENT_KINDS:
        state[f"alert_{kind}"] = state[f"alert_{kind}"].fillna(False).astype(bool)
    state["alert"] = None
    pol = bundle.meta.get("alert_policy")
    if pol:
        probs = {k: state.loc[slots, f"p_{k}"].to_numpy(dtype=float) for k in ALERT_KINDS}
        for s_, kind in run_policy(slots, probs, pol["thresholds"]):
            state.loc[s_, "alert"] = kind
    return ReplayOutputs(features=feats, state=state, forecasts=pd.concat(rows, ignore_index=True))


# ---------------------------------------------------------------------------
# Live, one reading at a time


@dataclass
class TwinUpdate:
    slot: int
    state: dict
    forecasts: list[dict] = field(default_factory=list)
    resolved: list[dict] = field(default_factory=list)
    alerts: list[str] = field(default_factory=list)
    abstain_reason: str | None = None


class LiveTwin:
    """Streaming twin. Feed readings and events in time order."""

    _ARRAYS = ("glucose", "meal", "meal_grams", "meal_carb", "fast_units", "basal_units",
               "pump_rate", "secretagogue", "agi", "biguanide", "oral")
    _NAN_ARRAYS = ("glucose", "meal_grams", "meal_carb", "pump_rate")

    def __init__(self, recording_id: str, patient_id: str, t0: pd.Timestamp, static: dict, bundle: ModelBundle):
        self.bundle = bundle
        self.t0 = pd.Timestamp(t0)
        self.series = Series(recording_id, patient_id, self.t0,
                             **{a: np.full(0, np.nan if a in self._NAN_ARRAYS else 0.0) for a in self._ARRAYS},
                             static=static)
        self.kstate: K.KalmanState | None = None
        self.kf_rows: list[list[float]] = []
        self.last_slot = -1
        self.ewm = {h: EWM(bundle.personal[h]["halflife"]) for h in HORIZONS_MIN}
        self.pending: dict[int, dict[int, tuple[int, float]]] = {h: {} for h in HORIZONS_MIN}
        self.last_alert = {k: -10**9 for k in EVENT_KINDS}
        self.policy = bundle.meta.get("alert_policy")
        self.policy_last_slot, self.policy_last_kind = -10**9, None

    def slot_of(self, ts: pd.Timestamp) -> int:
        return int(round((pd.Timestamp(ts) - self.t0).total_seconds() / 60 / STEP_MIN))

    def _grow(self, n: int) -> None:
        """Extend the slot arrays to length n (Kalman rows are padded with NaN)."""
        extra = n - self.series.n
        if extra <= 0:
            return
        for a in self._ARRAYS:
            fill = np.nan if a in self._NAN_ARRAYS else 0.0
            setattr(self.series, a, np.concatenate([getattr(self.series, a), np.full(extra, fill)]))
        self.kf_rows.extend([[np.nan] * 4 for _ in range(extra)])

    def ingest_event(self, ts: pd.Timestamp, kind: str, **v) -> int:
        """Log an event. Events at the slot of the next reading are allowed."""
        slot = self.slot_of(ts)
        if slot < self.last_slot:
            raise ValueError("Events must not be earlier than the latest reading")
        self._grow(slot + 1)
        s = self.series
        if kind == "meal":
            s.meal[slot] = 1
            if v.get("grams") is not None and not pd.isna(v.get("grams")):
                s.meal_grams[slot] = np.nansum([s.meal_grams[slot], v["grams"]])
                s.meal_carb[slot] = np.nansum([s.meal_carb[slot], v.get("carb_grams") or 0.0])
        elif kind in ("insulin", "csii_bolus", "insulin_iv"):
            s.fast_units[slot] += float(v.get("fast_units") or 0)
            s.basal_units[slot] += float(v.get("basal_units") or 0)
        elif kind == "csii_basal_rate":
            s.pump_rate[slot] = float(v["rate"])
        elif kind == "oral":
            s.oral[slot] = 1
            s.secretagogue[slot] = max(s.secretagogue[slot], float(v.get("secretagogue") or 0))
            s.agi[slot] = max(s.agi[slot], float(v.get("agi") or 0))
            s.biguanide[slot] = max(s.biguanide[slot], float(v.get("biguanide") or 0))
        else:
            raise ValueError(f"Unknown event kind {kind}")
        return slot

    def ingest_reading(self, ts: pd.Timestamp, glucose: float) -> TwinUpdate:
        slot = self.slot_of(ts)
        if slot <= self.last_slot:
            raise ValueError(f"Reading at slot {slot} is not newer than slot {self.last_slot}")
        self._grow(slot + 1)
        self.series.glucose[slot] = glucose
        kp = self.bundle.kalman
        if self.kstate is None:
            self.kstate = K.init_state(glucose)
        else:
            # Prediction-only steps across slots that had no reading (sensor gap).
            for j in range(self.last_slot + 1, slot):
                self.kstate = K.step(self.kstate, None, kp)
                st = self.kstate
                self.kf_rows[j] = [st.level, st.slope, st.level_sd, st.slope_sd]
            self.kstate = K.step(self.kstate, glucose, kp)
        st = self.kstate
        self.kf_rows[slot] = [st.level, st.slope, st.level_sd, st.slope_sd]
        self.last_slot = slot

        # 1. Resolve forecasts whose target time has arrived.
        resolved = []
        for h in HORIZONS_MIN:
            pend = self.pending[h]
            for tgt in sorted(t for t in pend if t <= slot):
                issue, yhat_pop = pend.pop(tgt)
                if tgt == slot:
                    resid = glucose - yhat_pop
                    self.ewm[h].update(resid)
                    resolved.append({"horizon": h, "issue_slot": issue, "target_slot": tgt,
                                     "actual": glucose, "error": -resid})

        # 2. Recompute features on the history (slots <= now only).
        hist = self.series.truncate(slot)
        feats = build_features(hist, kp, kf=np.array(self.kf_rows[: slot + 1], dtype=float))
        row = feats.iloc[[slot]]
        state = {c: (float(row[c].iloc[0]) if c != "issuable" else bool(row[c].iloc[0]))
                 for c in STATE_COLUMNS if c in row.columns}
        state["glucose"] = glucose
        upd = TwinUpdate(slot=slot, state=state, resolved=resolved)
        if not bool(row["issuable"].iloc[0]):
            upd.abstain_reason = "Fewer than 8 readings in the last 3 h"
            return upd

        # 3. Forecast, apply this patient's learned correction, queue for scoring.
        pred = self.bundle.predict(row)
        for h in HORIZONS_MIN:
            yhat_pop = float(pred[f"yhat_{h}"][0])
            bias = self.bundle.personal[h]["lambda"] * self.ewm[h].value
            state[f"bias_{h}"] = bias
            tgt = slot + horizon_slots(h)
            self.pending[h][tgt] = (slot, yhat_pop)
            upd.forecasts.append({"issue_slot": slot, "horizon": h, "target_slot": tgt,
                                  "yhat_pop": yhat_pop, "yhat": yhat_pop + bias,
                                  "lo": float(pred[f"lo_{h}"][0]) + bias, "hi": float(pred[f"hi_{h}"][0]) + bias})
        for kind in EVENT_KINDS:
            p = float(pred[f"p_{kind}"][0]) if at_risk(kind, glucose) else float("nan")
            state[f"p_{kind}"] = p
            fire = np.isfinite(p) and p >= self.bundle.thresholds[kind] and slot - self.last_alert[kind] >= REFRACTORY_SLOTS
            state[f"alert_{kind}"] = bool(fire)
            if fire:
                self.last_alert[kind] = slot
        # Consolidated alert stream (same rule as evaluation.alerts.run_policy).
        state["alert"] = None
        if self.policy:
            refr = REFRACTORY_SLOTS
            for kind in ALERT_KINDS:
                v = state[f"p_{kind}"]
                if not np.isfinite(v) or v < self.policy["thresholds"][kind]:
                    continue
                cooling = slot - self.policy_last_slot < refr
                breakthrough = kind == "hypo" and self.policy_last_kind == "hyper2"
                if cooling and not breakthrough:
                    break
                state["alert"] = kind
                self.policy_last_slot, self.policy_last_kind = slot, kind
                upd.alerts.append(kind)
                break
        upd.state = state
        return upd

    def features_now(self) -> pd.DataFrame:
        hist = self.series.truncate(self.last_slot)
        return build_features(hist, self.bundle.kalman, kf=np.array(self.kf_rows[: self.last_slot + 1], dtype=float))
