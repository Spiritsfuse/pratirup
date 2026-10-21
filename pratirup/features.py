"""Feature and target construction.

Every feature at slot s is a function of data at slots <= s only. This is
enforced by tests/test_leakage.py, which recomputes features on a series
truncated at s and requires identical values. Targets are built separately and
are the only place future readings are read.

The same `build_features` function is used for training, offline evaluation
and the live twin, so there is no training/serving skew.
"""

from __future__ import annotations

import warnings
from dataclasses import dataclass, field

import numpy as np
import pandas as pd

from pratirup.config import (
    EVENT_CONSECUTIVE, EVENT_WINDOW_MIN, HORIZONS_MIN, HYPER, HYPER_L2, HYPO,
    LOOKBACK_SLOTS, MIN_HISTORY_READINGS, SLOTS_PER_DAY, STEP_MIN, horizon_slots,
)
from pratirup.twin.kalman import KalmanParams, filter_series

STATIC_FEATURES = [
    "age", "is_male", "bmi", "diabetes_duration_y", "hba1c_pct", "glycated_albumin_pct",
    "fpg_mgdl", "ppg2h_mgdl", "cpeptide_fasting_nmol", "cpeptide_2h_nmol",
    "insulin_fasting_pmol", "insulin_2h_pmol", "tc_mmol", "tg_mmol", "hdl_mmol", "ldl_mmol",
    "creatinine_umol", "egfr", "uric_acid", "bun_mmol", "smoking_pack_years", "is_drinker",
    "comp_neuropathy", "comp_retinopathy", "comp_nephropathy", "comp_macrovascular",
    "comorb_hypertension", "comorb_dyslipidemia", "comorb_fatty_liver",
    "rx_insulin", "rx_biguanide", "rx_agi", "rx_sulfonylurea", "rx_glinide", "rx_dpp4",
    "rx_sglt2", "rx_tzd", "rx_glp1",
]

LAG_DIFFS = (1, 2, 3, 4, 6, 8, 12)

CGM_FEATURES = (
    ["g0"] + [f"d{k}" for k in LAG_DIFFS]
    + ["accel", "mean_1h", "sd_1h", "min_1h", "max_1h", "mean_3h", "sd_3h", "min_3h", "max_3h",
       "n_missing_3h", "roughness_3h", "kf_level", "kf_slope", "kf_level_sd", "kf_slope_sd", "kf_resid"]
)
TIME_FEATURES = ["tod_sin", "tod_cos", "hours_since_start"]
EVENT_FEATURES = [
    "min_since_meal", "last_meal_grams", "last_meal_carb_grams", "carb_on_board", "meals_3h",
    "min_since_fast_insulin", "fast_iob", "fast_units_4h", "basal_units_24h", "pump_basal_rate",
    "min_since_secretagogue", "min_since_agi", "min_since_biguanide", "min_since_oral",
]
PROFILE_FEATURES = (
    ["exp_mean", "exp_sd", "exp_tar", "exp_tbr", "prof_level", "prof_days"]
    + [f"prof_delta_{h}" for h in HORIZONS_MIN]
)

FEATURE_GROUPS: dict[str, list[str]] = {
    "cgm": CGM_FEATURES,
    "time": TIME_FEATURES,
    "events": EVENT_FEATURES,
    "ehr": STATIC_FEATURES,
    "profile": PROFILE_FEATURES,
}

# Ablation ladder reported in the benchmark.
FEATURE_SETS: dict[str, list[str]] = {
    "cgm": CGM_FEATURES + TIME_FEATURES,
    "cgm+events": CGM_FEATURES + TIME_FEATURES + EVENT_FEATURES,
    "cgm+events+ehr": CGM_FEATURES + TIME_FEATURES + EVENT_FEATURES + STATIC_FEATURES,
    "full": CGM_FEATURES + TIME_FEATURES + EVENT_FEATURES + STATIC_FEATURES + PROFILE_FEATURES,
}


@dataclass
class Series:
    """One recording on the slot grid. Arrays are indexed by slot."""

    recording_id: str
    patient_id: str
    t0: pd.Timestamp
    glucose: np.ndarray
    meal: np.ndarray = field(default=None)            # 1 where a meal is logged
    meal_grams: np.ndarray = field(default=None)      # NaN if not described
    meal_carb: np.ndarray = field(default=None)
    fast_units: np.ndarray = field(default=None)      # s.c. fast + pump bolus + i.v.
    basal_units: np.ndarray = field(default=None)     # s.c. basal component
    pump_rate: np.ndarray = field(default=None)       # NaN where unchanged
    secretagogue: np.ndarray = field(default=None)
    agi: np.ndarray = field(default=None)
    biguanide: np.ndarray = field(default=None)
    oral: np.ndarray = field(default=None)
    static: dict = field(default_factory=dict)

    @property
    def n(self) -> int:
        return len(self.glucose)

    def truncate(self, upto: int) -> "Series":
        """Copy containing slots <= upto only."""
        kw = {}
        for name in ("glucose", "meal", "meal_grams", "meal_carb", "fast_units", "basal_units",
                     "pump_rate", "secretagogue", "agi", "biguanide", "oral"):
            kw[name] = getattr(self, name)[: upto + 1].copy()
        return Series(self.recording_id, self.patient_id, self.t0, static=self.static, **kw)

    def slot_times(self) -> pd.DatetimeIndex:
        return self.t0 + pd.to_timedelta(np.arange(self.n) * STEP_MIN, unit="min")


def build_series(recording: pd.Series, cgm: pd.DataFrame, events: pd.DataFrame) -> Series:
    n = int(max(cgm["slot"].max(), events["slot"].max() if len(events) else 0)) + 1
    g = np.full(n, np.nan)
    g[cgm["slot"].to_numpy()] = cgm["glucose"].to_numpy()

    def zeros():
        return np.zeros(n)

    s = Series(
        recording_id=str(recording["recording_id"]),
        patient_id=str(recording["patient_id"]),
        t0=pd.Timestamp(recording["start_ts"]),
        glucose=g, meal=zeros(), meal_grams=np.full(n, np.nan), meal_carb=np.full(n, np.nan),
        fast_units=zeros(), basal_units=zeros(), pump_rate=np.full(n, np.nan),
        secretagogue=zeros(), agi=zeros(), biguanide=zeros(), oral=zeros(),
        static={k: recording.get(k) for k in STATIC_FEATURES},
    )
    for e in events.itertuples(index=False):
        i = int(e.slot)
        if e.kind == "meal":
            s.meal[i] = 1
            if getattr(e, "described", False) and pd.notna(e.grams):
                s.meal_grams[i] = np.nansum([s.meal_grams[i], e.grams])
                s.meal_carb[i] = np.nansum([s.meal_carb[i], e.carb_grams])
        elif e.kind in ("insulin", "csii_bolus", "insulin_iv"):
            s.fast_units[i] += float(e.fast_units or 0)
            s.basal_units[i] += float(e.basal_units or 0)
        elif e.kind == "csii_basal_rate":
            s.pump_rate[i] = float(e.rate)
        elif e.kind == "oral":
            s.oral[i] = 1
            s.secretagogue[i] = max(s.secretagogue[i], float(e.secretagogue or 0))
            s.agi[i] = max(s.agi[i], float(e.agi or 0))
            s.biguanide[i] = max(s.biguanide[i], float(e.biguanide or 0))
    return s


def _minutes_since(flag: np.ndarray, cap: float = 720.0) -> np.ndarray:
    idx = np.where(flag > 0, np.arange(len(flag)), np.nan)
    last = pd.Series(idx).ffill().to_numpy()
    out = (np.arange(len(flag)) - last) * STEP_MIN
    return np.minimum(out, cap)


def _causal_decay_sum(x: np.ndarray, duration_slots: int) -> np.ndarray:
    """Sum of past amounts with linear decay to zero over `duration_slots`."""
    w = 1.0 - np.arange(duration_slots) / duration_slots
    out = np.convolve(np.nan_to_num(x), w)[: len(x)]
    return out


def _last_value_at(flag: np.ndarray, values: np.ndarray) -> np.ndarray:
    v = np.where(flag > 0, np.where(np.isnan(values), -1.0, values), np.nan)
    v = pd.Series(v).ffill().to_numpy()
    return np.where(v == -1.0, np.nan, v)


def build_features(s: Series, kp: KalmanParams, kf: np.ndarray | None = None) -> pd.DataFrame:
    """Features for every slot of `s`. `kf` lets the live twin pass its
    incrementally maintained Kalman output instead of re-filtering history."""
    g = s.glucose
    n = s.n
    gs = pd.Series(g)
    f: dict[str, np.ndarray] = {}

    f["g0"] = g
    for k in LAG_DIFFS:
        f[f"d{k}"] = g - gs.shift(k).to_numpy()
    f["accel"] = (g - gs.shift(1).to_numpy()) - (gs.shift(1).to_numpy() - gs.shift(2).to_numpy())
    for name, w in (("1h", 4), ("3h", LOOKBACK_SLOTS)):
        r = gs.rolling(w, min_periods=1)
        f[f"mean_{name}"] = r.mean().to_numpy()
        f[f"sd_{name}"] = gs.rolling(w, min_periods=2).std().to_numpy()
        f[f"min_{name}"] = r.min().to_numpy()
        f[f"max_{name}"] = r.max().to_numpy()
    f["n_missing_3h"] = pd.Series(np.isnan(g).astype(float)).rolling(LOOKBACK_SLOTS, min_periods=1).sum().to_numpy()
    # Signal roughness: SD of second differences over the last 3 h. Smooth sensor
    # output gives small values; uncorrelated noise inflates it, which lets a
    # noise-aware model discount reading-to-reading change.
    second = pd.Series(g - 2 * gs.shift(1).to_numpy() + gs.shift(2).to_numpy())
    f["roughness_3h"] = second.rolling(LOOKBACK_SLOTS, min_periods=4).std().to_numpy()
    if kf is None:
        kf = filter_series(g, kp)
    f["kf_level"], f["kf_slope"], f["kf_level_sd"], f["kf_slope_sd"] = kf.T
    f["kf_resid"] = g - kf[:, 0]

    times = s.slot_times()
    tod = (times.hour * 60 + times.minute).to_numpy() / 1440.0
    f["tod_sin"] = np.sin(2 * np.pi * tod)
    f["tod_cos"] = np.cos(2 * np.pi * tod)
    f["hours_since_start"] = np.minimum(np.arange(n) * STEP_MIN / 60.0, 72.0)

    f["min_since_meal"] = _minutes_since(s.meal)
    f["last_meal_grams"] = _last_value_at(s.meal, s.meal_grams)
    f["last_meal_carb_grams"] = _last_value_at(s.meal, s.meal_carb)
    f["carb_on_board"] = _causal_decay_sum(s.meal_carb, 12)        # 3 h
    f["meals_3h"] = pd.Series(s.meal).rolling(LOOKBACK_SLOTS, min_periods=1).sum().to_numpy()
    f["min_since_fast_insulin"] = _minutes_since(s.fast_units)
    f["fast_iob"] = _causal_decay_sum(s.fast_units, 16)              # 4 h
    f["fast_units_4h"] = pd.Series(s.fast_units).rolling(16, min_periods=1).sum().to_numpy()
    f["basal_units_24h"] = pd.Series(s.basal_units).rolling(SLOTS_PER_DAY, min_periods=1).sum().to_numpy()
    f["pump_basal_rate"] = pd.Series(s.pump_rate).ffill().to_numpy()
    f["min_since_secretagogue"] = _minutes_since(s.secretagogue)
    f["min_since_agi"] = _minutes_since(s.agi)
    f["min_since_biguanide"] = _minutes_since(s.biguanide)
    f["min_since_oral"] = _minutes_since(s.oral)

    # Personal profile: expanding statistics and same-time-of-day history.
    exp = gs.expanding(min_periods=SLOTS_PER_DAY // 2)
    f["exp_mean"] = exp.mean().to_numpy()
    f["exp_sd"] = exp.std().to_numpy()
    valid_cnt = pd.Series(np.isfinite(g).astype(float)).cumsum().to_numpy()
    tar = pd.Series((g > HYPER).astype(float)).cumsum().to_numpy()
    tbr = pd.Series((g < HYPO).astype(float)).cumsum().to_numpy()
    enough = valid_cnt >= SLOTS_PER_DAY // 2
    f["exp_tar"] = np.where(enough, tar / np.maximum(valid_cnt, 1), np.nan)
    f["exp_tbr"] = np.where(enough, tbr / np.maximum(valid_cnt, 1), np.nan)
    levels, deltas = [], {h: [] for h in HORIZONS_MIN}
    for j in range(1, 8):
        base = gs.shift(SLOTS_PER_DAY * j).to_numpy()
        levels.append(base)
        for h in HORIZONS_MIN:
            hs = horizon_slots(h)
            deltas[h].append(gs.shift(SLOTS_PER_DAY * j - hs).to_numpy() - base)
    L = np.vstack(levels)
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", category=RuntimeWarning)
        f["prof_level"] = np.where(np.isfinite(L).any(0), np.nanmean(np.where(np.isfinite(L), L, np.nan), axis=0), np.nan)
        f["prof_days"] = np.isfinite(L).sum(0).astype(float)
        for h in HORIZONS_MIN:
            D = np.vstack(deltas[h])
            f[f"prof_delta_{h}"] = np.where(np.isfinite(D).any(0), np.nanmean(D, axis=0), np.nan)

    for k in STATIC_FEATURES:
        v = s.static.get(k)
        f[k] = np.full(n, np.nan if v is None or pd.isna(v) else float(v))

    df = pd.DataFrame(f)
    df.insert(0, "slot", np.arange(n))
    df.insert(0, "ts", times)
    df.insert(0, "patient_id", s.patient_id)
    df.insert(0, "recording_id", s.recording_id)
    hist = pd.Series(np.isfinite(g).astype(float)).rolling(LOOKBACK_SLOTS, min_periods=1).sum().to_numpy()
    df["issuable"] = np.isfinite(g) & (hist >= MIN_HISTORY_READINGS)
    return df


def _consecutive_any(future: np.ndarray, cond) -> np.ndarray:
    """future: (n, w) readings at s+1..s+w. True if EVENT_CONSECUTIVE consecutive meet cond."""
    c = cond(future)
    k = EVENT_CONSECUTIVE
    hit = np.zeros(future.shape[0], dtype=bool)
    for start in range(future.shape[1] - k + 1):
        hit |= c[:, start : start + k].all(axis=1)
    return hit


def build_targets(s: Series) -> pd.DataFrame:
    """Future-derived targets. Never used as model inputs."""
    g = s.glucose
    gs = pd.Series(g)
    t: dict[str, np.ndarray] = {}
    for h in HORIZONS_MIN:
        fut = gs.shift(-horizon_slots(h)).to_numpy()
        t[f"y_{h}"] = fut
        t[f"dy_{h}"] = fut - g
    w = horizon_slots(EVENT_WINDOW_MIN)
    future = np.column_stack([gs.shift(-k).to_numpy() for k in range(1, w + 1)])
    complete = np.isfinite(future).all(axis=1) & np.isfinite(g)
    for name, thr, above in (("hyper", HYPER, True), ("hyper2", HYPER_L2, True), ("hypo", HYPO, False)):
        at_risk = (g <= thr) if above else (g >= thr)
        cond = (lambda x, t_=thr: x > t_) if above else (lambda x, t_=thr: x < t_)
        lab = _consecutive_any(np.nan_to_num(future, nan=-1e9 if above else 1e9), cond).astype(float)
        lab[~(complete & at_risk)] = np.nan
        t[f"ev_{name}"] = lab
        t[f"atrisk_{name}"] = (at_risk & np.isfinite(g)).astype(float)
    return pd.DataFrame(t)


def build_dataset(recordings: pd.DataFrame, cgm: pd.DataFrame, events: pd.DataFrame,
                  kp: KalmanParams, with_targets: bool = True) -> pd.DataFrame:
    parts = []
    cgm_g = dict(tuple(cgm.groupby("recording_id")))
    ev_g = dict(tuple(events.groupby("recording_id")))
    empty_ev = events.iloc[0:0]
    for _, rec in recordings.iterrows():
        rid = rec["recording_id"]
        s = build_series(rec, cgm_g[rid], ev_g.get(rid, empty_ev))
        feats = build_features(s, kp)
        if with_targets:
            feats = pd.concat([feats, build_targets(s)], axis=1)
        parts.append(feats)
    return pd.concat(parts, ignore_index=True)


def series_by_recording(recordings: pd.DataFrame, cgm: pd.DataFrame, events: pd.DataFrame) -> dict[str, Series]:
    cgm_g = dict(tuple(cgm.groupby("recording_id")))
    ev_g = dict(tuple(events.groupby("recording_id")))
    empty_ev = events.iloc[0:0]
    return {
        rec["recording_id"]: build_series(rec, cgm_g[rec["recording_id"]], ev_g.get(rec["recording_id"], empty_ev))
        for _, rec in recordings.iterrows()
    }
