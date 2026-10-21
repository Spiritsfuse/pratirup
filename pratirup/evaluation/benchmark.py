"""Benchmark protocol.

Stage `dev`  (repeatable): everything is decided on the 80 development patients
  with 5-fold patient-grouped cross-validation: Kalman parameters, LightGBM
  hyperparameters, conformal adjustment, personalisation parameters, isotonic
  calibration and alert thresholds. Final models are fit on all dev patients.

Stage `test` (once): the frozen bundle is scored on the 20 held-out patients.
  A lock file records when; re-running requires an explicit reason, which is
  appended to the run log.
"""

from __future__ import annotations

import datetime as dt
import json
import subprocess
import time
from itertools import product

import numpy as np
import pandas as pd
from sklearn.impute import SimpleImputer
from sklearn.isotonic import IsotonicRegression
from sklearn.linear_model import Ridge
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

from pratirup.config import (
    DATA_PROCESSED, FALSE_ALERT_BUDGET_PER_DAY, HORIZONS_MIN, MODELS_DIR, PI_COVERAGE,
    RESULTS_DIR, SEED, horizon_slots,
)
from pratirup.evaluation import metrics as M
from pratirup.features import (
    CGM_FEATURES, FEATURE_SETS, LAG_DIFFS, build_dataset, series_by_recording,
)
from pratirup.models import lgbm
from pratirup.models import seq as gru
from pratirup.models.bundle import EVENT_KINDS, Isotonic, ModelBundle, personal_bias
from pratirup.evaluation import alerts as A
from pratirup.twin.kalman import KalmanParams, damped_forecast, filter_series

ALPHA = 1 - PI_COVERAGE
RIDGE_FEATURES = ["g0"] + [f"d{k}" for k in LAG_DIFFS] + ["accel", "mean_1h", "sd_1h", "mean_3h", "sd_3h"]
TUNING_GRID = [
    {"num_leaves": nl, "min_data_in_leaf": md, "feature_fraction": ff, "lambda_l2": l2}
    for nl, md, ff, l2 in [
        (15, 300, 0.8, 1.0), (31, 300, 0.8, 1.0), (63, 300, 0.8, 1.0), (31, 100, 0.8, 1.0),
        (31, 800, 0.8, 1.0), (31, 300, 0.5, 1.0), (31, 300, 0.8, 10.0), (15, 800, 0.5, 10.0),
    ]
]
MODEL_VERSION = "2"
# v2: every LightGBM model also trains on noise-augmented copies of the development
# recordings (selected by scripts/exp_noise_robustness.py on dev data only).
TRAIN_NOISE_SD = (5.0, 10.0, 15.0)
PERSONAL_GRID = {"lambda": [0.0, 0.25, 0.5, 0.75, 1.0], "halflife": [4, 12, 24, 48, 96]}


def _git_commit() -> str:
    try:
        return subprocess.check_output(["git", "rev-parse", "--short", "HEAD"], text=True).strip()
    except Exception:
        return "unknown"


def _log(msg: str) -> None:
    print(f"[{dt.datetime.now():%H:%M:%S}] {msg}", flush=True)


def load_tables() -> dict[str, pd.DataFrame]:
    return {n: pd.read_parquet(DATA_PROCESSED / f"shanghai_{n}.parquet") for n in ("recordings", "cgm", "events")}


def load_split() -> dict:
    return json.loads((DATA_PROCESSED / "split.json").read_text())


# ---------------------------------------------------------------------------
# Kalman tuning (dev only)


def tune_kalman(series: dict) -> tuple[KalmanParams, list[dict]]:
    # Initial grid optimum sat on its edges (q_slope max, r min, phi min), so the
    # grid extends beyond them to confirm an interior optimum.
    grid = list(product([0.25, 1.0, 4.0], [1.0, 4.0, 9.0, 16.0], [1.0, 2.0, 4.0, 9.0]))
    phis = [0.3, 0.4, 0.5, 0.6, 0.7, 0.85]
    trials = []
    for ql, qs, r in grid:
        kp = KalmanParams(ql, qs, r, 0.85)
        errs = {phi: [] for phi in phis}
        for s in series.values():
            kf = filter_series(s.glucose, kp)
            for h in (30, 60):
                hs = horizon_slots(h)
                fut = np.roll(s.glucose, -hs)
                fut[-hs:] = np.nan
                ok = np.isfinite(fut) & np.isfinite(kf[:, 0]) & np.isfinite(s.glucose)
                for phi in phis:
                    pred = damped_forecast(kf[ok, 0], kf[ok, 1], hs, phi)
                    errs[phi].append(np.abs(pred - fut[ok]))
        for phi in phis:
            mae = float(np.mean(np.concatenate(errs[phi])))
            trials.append({"q_level": ql, "q_slope": qs, "r": r, "phi": phi, "mae_30_60": mae})
    best = min(trials, key=lambda t: t["mae_30_60"])
    return KalmanParams(best["q_level"], best["q_slope"], best["r"], best["phi"]), trials


# ---------------------------------------------------------------------------
# Helpers


def _event_records(df: pd.DataFrame, glucose_by_rec: dict, score: np.ndarray, kind: str) -> list[dict]:
    out = []
    for rid, idx in df.groupby("recording_id", sort=False).indices.items():
        g = glucose_by_rec[rid]
        out.append({
            "slots": df["slot"].to_numpy()[idx],
            "score": score[idx],
            "onsets": M.episode_onsets(g, kind),
            "n_readings": int(np.isfinite(g).sum()),
        })
    return out


def _score_grid(score: np.ndarray) -> np.ndarray:
    s = score[np.isfinite(score)]
    return np.unique(np.quantile(s, np.linspace(0.5, 0.999, 120)))


def _rule_scores(df: pd.DataFrame, kp: KalmanParams, kind: str) -> dict[str, np.ndarray]:
    """Simple alerting baselines: rate-of-change extrapolation and Kalman trend."""
    g0, d1 = df["g0"].to_numpy(), np.nan_to_num(df["d1"].to_numpy())
    trend = np.vstack([g0 + k * d1 for k in (1, 2, 3, 4)])
    kal = np.vstack([damped_forecast(df["kf_level"].to_numpy(), df["kf_slope"].to_numpy(), k, kp.phi) for k in (1, 2, 3, 4)])
    if kind == "hypo":
        return {"trend_rule": -trend.min(0), "kalman_rule": -kal.min(0)}
    return {"trend_rule": trend.max(0), "kalman_rule": kal.max(0)}


def build_augmented(series: dict, kp: KalmanParams, fold_of: dict) -> pd.DataFrame:
    """Noisy copies of each development recording: features from a perturbed
    series (noise SD drawn from TRAIN_NOISE_SD), targets from the clean series."""
    from pratirup.features import build_features, build_targets
    rng = np.random.default_rng(SEED + 1)
    parts = []
    for rid in sorted(series):
        s = series[rid]
        sd = float(rng.choice(TRAIN_NOISE_SD))
        ns = _perturb(s, f"noise{sd:g}", rng)
        parts.append(pd.concat([build_features(ns, kp), build_targets(s)], axis=1))
    aug = pd.concat(parts, ignore_index=True)
    aug = aug[aug["issuable"]].reset_index(drop=True)
    aug["fold"] = aug["patient_id"].map(fold_of).astype(int)
    return aug


def _policy_records(data: pd.DataFrame, glucose_by_rec: dict, probs: dict[str, pd.Series]) -> list[dict]:
    """Per-recording inputs for the consolidated alert policy. probs[kind] is
    indexed by (recording_id, slot); slots where a kind is not at risk are NaN."""
    out = []
    for rid, idx in data.groupby("recording_id", sort=False).indices.items():
        sub = data.iloc[idx]
        key = pd.MultiIndex.from_arrays([sub["recording_id"], sub["slot"]])
        g = glucose_by_rec[rid]
        out.append({
            "slots": sub["slot"].to_numpy(),
            "p": {k: probs[k].reindex(key).to_numpy() for k in A.ALERT_KINDS},
            "onsets": {k: M.episode_onsets(g, k) for k in A.ALERT_KINDS},
            "n_readings": int(np.isfinite(g).sum()),
        })
    return out


# ---------------------------------------------------------------------------
# Stage: dev


def run_dev() -> dict:
    t_start = time.time()
    tables = load_tables()
    split = load_split()
    recs = tables["recordings"]
    test_ids = set(split["test_patients"])
    dev_recs = recs[~recs["patient_id"].isin(test_ids)]
    fold_of = split["dev_folds"]

    _log("Tuning Kalman filter on dev patients")
    dev_series = series_by_recording(dev_recs, tables["cgm"], tables["events"])
    kp, k_trials = tune_kalman(dev_series)
    _log(f"Kalman: {kp}")

    _log("Building features")
    data = build_dataset(dev_recs, tables["cgm"], tables["events"], kp)
    data = data[data["issuable"]].reset_index(drop=True)
    data["fold"] = data["patient_id"].map(fold_of).astype(int)
    glucose_by_rec = {rid: s.glucose for rid, s in dev_series.items()}
    results: dict = {"kalman": {"params": kp.to_dict(), "n_trials": len(k_trials)}}

    _log("Building noise-augmented training copies")
    aug = build_augmented(dev_series, kp, fold_of)
    results["augmentation"] = {"noise_sd_choices": list(TRAIN_NOISE_SD), "rows": int(len(aug))}

    def ex(cols, target):
        m = np.isfinite(aug[target].to_numpy())
        a = aug[m]
        return (a[cols].reset_index(drop=True), a[target].to_numpy(), a["patient_id"].to_numpy(), a["fold"].to_numpy())

    # Common evaluation rows per horizon: issuable, target present.
    rows = {h: np.isfinite(data[f"dy_{h}"].to_numpy()) for h in HORIZONS_MIN}
    rows_any = np.logical_or.reduce([rows[h] for h in HORIZONS_MIN])

    # Training-range envelope used to flag out-of-distribution inputs.
    ranges = {f: [float(np.nanpercentile(data[f], 1)), float(np.nanpercentile(data[f], 99)),
                  float(np.nanmin(data[f])), float(np.nanmax(data[f]))]
              for f in FEATURE_SETS["full"] if np.isfinite(data[f]).any()}
    MODELS_DIR.mkdir(parents=True, exist_ok=True)
    (MODELS_DIR / "feature_ranges.json").write_text(json.dumps(ranges, indent=2))

    _log("CV GRU sequence model (all horizons jointly)")
    d_any = data[rows_any].reset_index(drop=True)
    gru_oof_any, gru_epochs = gru.cross_validate(dev_series, d_any)
    gru_oof = np.full((len(data), len(HORIZONS_MIN)), np.nan)
    gru_oof[rows_any] = gru_oof_any
    results["gru"] = {"cv_best_epochs": gru_epochs}

    _log("Tuning LightGBM hyperparameters (60 min, full features)")
    feats_full = FEATURE_SETS["full"]
    d60 = data[rows[60]]
    tuning = []
    for cfg in TUNING_GRID:
        cv = lgbm.cross_validate(d60[feats_full], d60["dy_60"].to_numpy(), d60["patient_id"].to_numpy(),
                                 d60["fold"].to_numpy(), cfg, extra=ex(feats_full, "dy_60"))
        mae = float(np.mean(np.abs(cv.oof - d60["dy_60"].to_numpy())))
        tuning.append({**cfg, "cv_mae": mae, "n_iter": cv.n_iter})
        _log(f"  {cfg} -> CV MAE {mae:.2f}")
    best_cfg = {k: v for k, v in min(tuning, key=lambda t: t["cv_mae"]).items() if k in TUNING_GRID[0]}
    results["lgbm_tuning"] = {"grid": tuning, "selected": best_cfg}

    # ---- forecasting ladder (OOF on dev) -------------------------------
    forecast = {h: {} for h in HORIZONS_MIN}
    oof_store: dict[int, pd.DataFrame] = {}
    n_iters: dict[str, dict[int, int]] = {}
    for h in HORIZONS_MIN:
        d = data[rows[h]].reset_index(drop=True)
        y = d[f"y_{h}"].to_numpy()
        g0 = d["g0"].to_numpy()
        preds = {
            "persistence": g0,
            "kalman_trend": damped_forecast(d["kf_level"].to_numpy(), d["kf_slope"].to_numpy(), horizon_slots(h), kp.phi),
        }
        ridge_oof = np.full(len(d), np.nan)
        for k in sorted(d["fold"].unique()):
            tr, va = d["fold"] != k, d["fold"] == k
            pipe = make_pipeline(SimpleImputer(strategy="median"), StandardScaler(), Ridge(alpha=1.0))
            pipe.fit(d.loc[tr, RIDGE_FEATURES], d.loc[tr, f"dy_{h}"])
            ridge_oof[va.to_numpy()] = g0[va.to_numpy()] + pipe.predict(d.loc[va, RIDGE_FEATURES])
        preds["ridge_ar"] = ridge_oof
        preds["gru_seq"] = g0 + gru_oof[rows[h], HORIZONS_MIN.index(h)]
        for name, feats in FEATURE_SETS.items():
            _log(f"  CV {h} min: lgbm[{name}]")
            cv = lgbm.cross_validate(d[feats], d[f"dy_{h}"].to_numpy(), d["patient_id"].to_numpy(),
                                     d["fold"].to_numpy(), best_cfg, extra=ex(feats, f"dy_{h}"))
            preds[f"lgbm[{name}]"] = g0 + cv.oof
            n_iters.setdefault(name, {})[h] = cv.n_iter
        preds["ensemble[lgbm+gru]"] = 0.5 * (preds["lgbm[full]"] + preds["gru_seq"])
        # Conformalised quantile regression on the full feature set.
        q = {}
        for side, a in (("lo", ALPHA / 2), ("hi", 1 - ALPHA / 2)):
            cv = lgbm.cross_validate(d[feats_full], d[f"dy_{h}"].to_numpy(), d["patient_id"].to_numpy(),
                                     d["fold"].to_numpy(), best_cfg, objective="quantile", alpha=a,
                                     extra=ex(feats_full, f"dy_{h}"))
            q[side] = g0 + cv.oof
            n_iters.setdefault(f"q_{side}", {})[h] = cv.n_iter
        scores = np.maximum(q["lo"] - y, y - q["hi"])
        nq = len(scores)
        qhat = float(np.quantile(scores, min(1.0, np.ceil((nq + 1) * (1 - ALPHA)) / nq)))
        frame = d[["recording_id", "patient_id", "slot", "fold"]].copy()
        frame["y"] = y
        for k_, v in preds.items():
            frame[k_] = v
        frame["q_lo"], frame["q_hi"], frame["qhat"] = q["lo"], q["hi"], qhat
        oof_store[h] = frame
        for k_, v in preds.items():
            forecast[h][k_] = {**M.point_metrics(y, v), "bands": M.band_mae(y, v), "parkes": M.parkes_summary(y, v)}
        forecast[h]["_interval_raw"] = M.interval_metrics(y, q["lo"], q["hi"])
        forecast[h]["_interval_conformal"] = {**M.interval_metrics(y, q["lo"] - qhat, q["hi"] + qhat), "qhat": qhat}

    # ---- personalisation (tuned on dev OOF) ----------------------------
    _log("Tuning personalisation")
    personal: dict[int, dict] = {}
    personal_trials: dict[int, list] = {}
    for h in HORIZONS_MIN:
        fr = oof_store[h].copy()
        fr["resid"] = fr["y"] - fr["lgbm[full]"]
        trials = []
        for hl in PERSONAL_GRID["halflife"]:
            b = personal_bias(fr, "resid", horizon_slots(h), hl)
            for lam in PERSONAL_GRID["lambda"]:
                mae = float(np.mean(np.abs(fr["lgbm[full]"] + lam * b - fr["y"])))
                trials.append({"halflife": hl, "lambda": lam, "mae": mae})
        bestp = min(trials, key=lambda t: t["mae"])
        personal[h] = {"lambda": bestp["lambda"], "halflife": float(bestp["halflife"])}
        personal_trials[h] = trials
        b = personal_bias(fr, "resid", horizon_slots(h), bestp["halflife"])
        v = fr["lgbm[full]"].to_numpy() + bestp["lambda"] * b
        oof_store[h]["lgbm[full]+personal"] = v
        y = fr["y"].to_numpy()
        forecast[h]["lgbm[full]+personal"] = {**M.point_metrics(y, v), "bands": M.band_mae(y, v), "parkes": M.parkes_summary(y, v)}
    results["forecast_dev_cv"] = forecast
    results["personalisation"] = {"selected": {str(k): v for k, v in personal.items()},
                                  "trials": {str(k): v for k, v in personal_trials.items()}}

    # ---- event classifiers ---------------------------------------------
    events: dict = {}
    classifiers_iter: dict[str, int] = {}
    calibrators: dict[str, Isotonic] = {}
    thresholds: dict[str, dict] = {}
    p60 = oof_store[60].set_index(["recording_id", "slot"])
    p30 = oof_store[30].set_index(["recording_id", "slot"])
    oof_p: dict[str, pd.Series] = {}
    for kind in EVENT_KINDS:
        m = np.isfinite(data[f"ev_{kind}"].to_numpy())
        d = data[m].reset_index(drop=True)
        y = d[f"ev_{kind}"].to_numpy()
        _log(f"  CV classifier {kind}: n={len(d)}, prevalence={y.mean():.3f}")
        cv = lgbm.cross_validate(d[feats_full], y, d["patient_id"].to_numpy(), d["fold"].to_numpy(),
                                 best_cfg, objective="binary", extra=ex(feats_full, f"ev_{kind}"))
        classifiers_iter[kind] = cv.n_iter
        iso = IsotonicRegression(out_of_bounds="clip", y_min=0, y_max=1).fit(cv.oof, y)
        xs = np.unique(np.quantile(cv.oof, np.linspace(0, 1, 201)))
        calibrators[kind] = Isotonic(x=xs.tolist(), y=iso.predict(xs).tolist())
        scores = {"classifier": calibrators[kind](cv.oof)}
        oof_p[kind] = pd.Series(scores["classifier"], index=pd.MultiIndex.from_arrays([d["recording_id"], d["slot"]]))
        scores.update(_rule_scores(d, kp, kind))
        key = list(zip(d["recording_id"], d["slot"]))
        f60 = p60.reindex(key)["lgbm[full]"].to_numpy()
        f30 = p30.reindex(key)["lgbm[full]"].to_numpy()
        fmax = np.fmax(f30, f60) if kind != "hypo" else -np.fmin(f30, f60)
        scores["forecast_rule"] = fmax
        res_kind = {}
        thresholds[kind] = {}
        for name, sc in scores.items():
            ok = np.isfinite(sc)
            recs_ev = _event_records(d[ok].reset_index(drop=True), glucose_by_rec, sc[ok], kind)
            thr = M.threshold_for_budget(recs_ev, FALSE_ALERT_BUDGET_PER_DAY, _score_grid(sc[ok]))
            thresholds[kind][name] = thr
            res_kind[name] = {"sample": M.sample_event_metrics(y[ok], sc[ok]),
                              "event": M.event_level(recs_ev, thr)}
        res_kind["classifier"]["calibration"] = M.calibration_bins(y, scores["classifier"])
        events[kind] = res_kind
    results["events_dev_cv"] = events
    results["thresholds"] = thresholds

    _log("Choosing the consolidated alert policy on dev OOF probabilities")
    policy_records = _policy_records(data, glucose_by_rec, {k: oof_p[k] for k in A.ALERT_KINDS})
    policy_thr, policy_res = A.choose_thresholds(policy_records)
    results["alert_policy_dev"] = policy_res

    # ---- final fit on all dev patients -------------------------------
    _log("Fitting final models on all dev patients")
    point, q_lo, q_hi = {}, {}, {}
    for h in HORIZONS_MIN:
        d = data[rows[h]]
        e = ex(feats_full, f"dy_{h}")[:2]
        point[h] = lgbm.fit(d[feats_full], d[f"dy_{h}"].to_numpy(), best_cfg, n_iters["full"][h], extra=e)
        q_lo[h] = lgbm.fit(d[feats_full], d[f"dy_{h}"].to_numpy(), best_cfg, n_iters["q_lo"][h], "quantile", ALPHA / 2, extra=e)
        q_hi[h] = lgbm.fit(d[feats_full], d[f"dy_{h}"].to_numpy(), best_cfg, n_iters["q_hi"][h], "quantile", 1 - ALPHA / 2, extra=e)
    classifiers = {}
    for kind in EVENT_KINDS:
        d = data[np.isfinite(data[f"ev_{kind}"].to_numpy())]
        classifiers[kind] = lgbm.fit(d[feats_full], d[f"ev_{kind}"].to_numpy(), best_cfg, classifiers_iter[kind], "binary",
                                     extra=ex(feats_full, f"ev_{kind}")[:2])
    # Ablation models are refit too so the test stage can score the ladder.
    ladder = {}
    for name, feats in FEATURE_SETS.items():
        if name == "full":
            continue
        for h in HORIZONS_MIN:
            d = data[rows[h]]
            ladder[(name, h)] = lgbm.fit(d[feats], d[f"dy_{h}"].to_numpy(), best_cfg, n_iters[name][h],
                                         extra=ex(feats, f"dy_{h}")[:2])
    _log("Fitting final GRU")
    gru_model, gru_norm = gru.fit_final(dev_series, d_any)
    ridge = {}
    for h in HORIZONS_MIN:
        d = data[rows[h]]
        ridge[h] = make_pipeline(SimpleImputer(strategy="median"), StandardScaler(), Ridge(alpha=1.0)).fit(
            d[RIDGE_FEATURES], d[f"dy_{h}"])

    bundle = ModelBundle(
        kalman=kp, features=feats_full, point=point, q_lo=q_lo, q_hi=q_hi,
        conformal_q={h: float(oof_store[h]["qhat"].iloc[0]) for h in HORIZONS_MIN},
        personal=personal, classifiers=classifiers, calibrators=calibrators,
        thresholds={k: v["classifier"] for k, v in thresholds.items()},
        meta={
            "trained_at": dt.datetime.now().isoformat(timespec="seconds"),
            "git_commit": _git_commit(),
            "train_patients": int(data["patient_id"].nunique()),
            "train_rows": {str(h): int(rows[h].sum()) for h in HORIZONS_MIN},
            "lgbm_params": {**lgbm.BASE_PARAMS, **best_cfg},
            "n_iter": {k: {str(h): v for h, v in d.items()} for k, d in n_iters.items()},
            "classifier_n_iter": classifiers_iter,
            "data_manifest": json.loads((DATA_PROCESSED / "manifest.json").read_text()),
            "seed": SEED,
            "version": MODEL_VERSION,
            "augmentation": {"noise_sd_choices": list(TRAIN_NOISE_SD)},
            "alert_policy": {"kinds": list(A.ALERT_KINDS), "thresholds": policy_thr,
                             "cooldown_min": 60, "false_alert_budget_per_day": A.TOTAL_FALSE_ALERT_BUDGET},
        },
    )
    bundle.save(MODELS_DIR)
    # Ablation and baseline models are kept outside the serving bundle.
    abl_dir = MODELS_DIR / "ablation"
    abl_dir.mkdir(parents=True, exist_ok=True)
    for (name, h), booster in ladder.items():
        booster.save_model(str(abl_dir / f"forecast_{name}_{h}min.txt"))
    import pickle
    with (abl_dir / "ridge.pkl").open("wb") as f:
        pickle.dump(ridge, f)
    (abl_dir / "rule_thresholds.json").write_text(json.dumps(thresholds, indent=2))
    gru.save(gru_model, gru_norm, abl_dir / "gru.pt")

    results["meta"] = {
        "stage": "dev",
        "generated_at": dt.datetime.now().isoformat(timespec="seconds"),
        "git_commit": _git_commit(),
        "dev_patients": int(data["patient_id"].nunique()),
        "dev_recordings": int(data["recording_id"].nunique()),
        "issuable_rows": int(len(data)),
        "runtime_s": round(time.time() - t_start, 1),
    }
    RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    (RESULTS_DIR / "dev_cv.json").write_text(json.dumps(results, indent=2, default=float))
    _log(f"Dev stage done in {results['meta']['runtime_s']} s")
    return results


# ---------------------------------------------------------------------------
# Stage: test (run once)

TEST_LOCK = RESULTS_DIR / "TEST_LOCK.json"
RUN_LOG = RESULTS_DIR / "runs.jsonl"


def _perturb(series, kind: str, rng: np.random.Generator):
    import copy
    s = copy.deepcopy(series)
    g = s.glucose
    finite = np.flatnonzero(np.isfinite(g))
    if kind.startswith("drop"):
        frac = int(kind[4:]) / 100
        g[rng.choice(finite, size=int(len(finite) * frac), replace=False)] = np.nan
    elif kind == "gap60_daily":
        for start in range(int(rng.integers(0, 96)), len(g), 96):
            g[start : start + 4] = np.nan
    elif kind.startswith("noise"):
        sd = float(kind[5:])
        g[finite] = np.clip(g[finite] + rng.normal(0, sd, len(finite)), 40, 500)
    elif kind.startswith("arnoise"):
        # Autocorrelated sensor error, AR(1) with rho 0.7 and the given marginal SD,
        # closer to published CGM error models than independent noise.
        sd, rho = float(kind[7:]), 0.7
        e = np.zeros(len(finite))
        for i in range(len(finite)):
            e[i] = (rho * e[i - 1] if i else 0.0) + rng.normal(0, sd * np.sqrt(1 - rho ** 2))
        g[finite] = np.clip(g[finite] + e, 40, 500)
    return s


def run_test(reason: str | None = None) -> dict:
    RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    if TEST_LOCK.exists() and not reason:
        raise SystemExit(
            f"The test set was already evaluated ({json.loads(TEST_LOCK.read_text())['evaluated_at']}). "
            "Re-running requires --reason, which is logged in results/runs.jsonl."
        )
    import pickle

    import lightgbm as lgb

    from pratirup.features import FEATURE_GROUPS, build_features, build_targets

    tables = load_tables()
    split = load_split()
    recs = tables["recordings"]
    test_recs = recs[recs["patient_id"].isin(split["test_patients"])]
    bundle = ModelBundle.load(MODELS_DIR)
    kp = bundle.kalman
    abl_dir = MODELS_DIR / "ablation"
    with (abl_dir / "ridge.pkl").open("rb") as f:
        ridge = pickle.load(f)
    rule_thr = json.loads((abl_dir / "rule_thresholds.json").read_text())
    ladder = {(name, h): lgb.Booster(model_file=str(abl_dir / f"forecast_{name}_{h}min.txt"))
              for name in FEATURE_SETS if name != "full" for h in HORIZONS_MIN}

    series = series_by_recording(test_recs, tables["cgm"], tables["events"])
    glucose_by_rec = {rid: s.glucose for rid, s in series.items()}
    data = build_dataset(test_recs, tables["cgm"], tables["events"], kp)
    data = data[data["issuable"]].reset_index(drop=True)
    gru_model, gru_norm = gru.load(abl_dir / "gru.pt")
    gru_pred = gru.predict(gru_model, gru_norm, gru.sequences(series, data),
                           data[gru.CONTEXT_FEATURES].to_numpy(dtype=np.float32))
    out = bundle.predict(data)
    for k, v in out.items():
        data[k] = v

    results: dict = {}
    forecast, intervals, boot = {}, {}, {}
    pred_frames = []
    for h in HORIZONS_MIN:
        m = np.isfinite(data[f"dy_{h}"].to_numpy())
        d = data[m].reset_index(drop=True)
        y, g0 = d[f"y_{h}"].to_numpy(), d["g0"].to_numpy()
        preds = {
            "persistence": g0,
            "kalman_trend": damped_forecast(d["kf_level"].to_numpy(), d["kf_slope"].to_numpy(), horizon_slots(h), kp.phi),
            "ridge_ar": g0 + ridge[h].predict(d[RIDGE_FEATURES]),
            "gru_seq": g0 + gru_pred[m, HORIZONS_MIN.index(h)],
        }
        for name, feats in FEATURE_SETS.items():
            preds[f"lgbm[{name}]"] = (d[f"yhat_{h}"].to_numpy() if name == "full"
                                      else g0 + ladder[(name, h)].predict(d[feats]))
        preds["ensemble[lgbm+gru]"] = 0.5 * (preds["lgbm[full]"] + preds["gru_seq"])
        d["resid"] = y - preds["lgbm[full]"]
        pp = bundle.personal[h]
        bias = personal_bias(d, "resid", horizon_slots(h), pp["halflife"]) * pp["lambda"]
        preds["lgbm[full]+personal"] = preds["lgbm[full]"] + bias
        forecast[h] = {k: {**M.point_metrics(y, v), "bands": M.band_mae(y, v), "parkes": M.parkes_summary(y, v)}
                       for k, v in preds.items()}
        lo, hi = d[f"lo_{h}"].to_numpy(), d[f"hi_{h}"].to_numpy()
        intervals[h] = {"population": M.interval_metrics(y, lo, hi),
                        "personal": M.interval_metrics(y, lo + bias, hi + bias)}
        safe = {k: k.replace("[", "_").replace("]", "").replace("+", "_") for k in preds}
        bf = d[["patient_id"]].assign(y=y, **{safe[k]: v for k, v in preds.items()})
        boot[h] = {
            f"lgbm_full_vs_{b}": M.bootstrap_mae_diff(bf, "lgbm_full", b)
            for b in ("persistence", "kalman_trend", "ridge_ar", "gru_seq", "lgbm_cgm", "lgbm_cgm_events", "lgbm_cgm_events_ehr")
        }
        boot[h]["lgbm_full_personal_vs_lgbm_full"] = M.bootstrap_mae_diff(bf, "lgbm_full_personal", "lgbm_full")
        boot[h]["ensemble_lgbm_gru_vs_lgbm_full"] = M.bootstrap_mae_diff(bf, "ensemble_lgbm_gru", "lgbm_full")
        pf = d[["recording_id", "patient_id", "slot", "ts", "g0"]].copy()
        pf["horizon"] = h
        pf["y"] = y
        for k in ("persistence", "kalman_trend", "lgbm[full]", "lgbm[full]+personal"):
            pf[k] = preds[k]
        pf["lo"], pf["hi"] = lo + bias, hi + bias
        pred_frames.append(pf)
    results["forecast_test"] = forecast
    results["intervals_test"] = intervals
    results["bootstrap_test"] = boot

    events = {}
    for kind in EVENT_KINDS:
        m = np.isfinite(data[f"ev_{kind}"].to_numpy())
        d = data[m].reset_index(drop=True)
        y = d[f"ev_{kind}"].to_numpy()
        scores = {"classifier": d[f"p_{kind}"].to_numpy()}
        scores.update(_rule_scores(d, kp, kind))
        scores["forecast_rule"] = (np.fmax(d["yhat_30"], d["yhat_60"]) if kind != "hypo"
                                   else -np.fmin(d["yhat_30"], d["yhat_60"])).to_numpy()
        res = {}
        for name, sc in scores.items():
            recs_ev = _event_records(d, glucose_by_rec, sc, kind)
            res[name] = {"sample": M.sample_event_metrics(y, sc), "event": M.event_level(recs_ev, rule_thr[kind][name])}
        res["classifier"]["calibration"] = M.calibration_bins(y, scores["classifier"])
        events[kind] = res
    results["events_test"] = events

    pol = bundle.meta.get("alert_policy")
    if pol:
        g0 = data["g0"].to_numpy()
        risk_mask = {"hypo": g0 >= 70, "hyper2": g0 <= 250}
        key = pd.MultiIndex.from_arrays([data["recording_id"], data["slot"]])
        probs = {k: pd.Series(np.where(risk_mask[k], data[f"p_{k}"], np.nan), index=key) for k in A.ALERT_KINDS}
        results["alert_policy_test"] = A.evaluate_policy(_policy_records(data, glucose_by_rec, probs), pol["thresholds"])
        _log(f"Alert policy on test: {results['alert_policy_test']}")

    static = recs.set_index("recording_id")
    data["rx_insulin_grp"] = data["recording_id"].map(static["rx_insulin"]).map({1: "insulin", 0: "no_insulin"})
    data["hba1c_grp"] = np.where(data["recording_id"].map(static["hba1c_pct"]) >= 8.0, "hba1c_ge_8", "hba1c_lt_8")
    subgroups = {}
    for col in ("rx_insulin_grp", "hba1c_grp"):
        for grp, d in data.groupby(col):
            entry = {"patients": int(d["patient_id"].nunique())}
            for h in (30, 60):
                mm = np.isfinite(d[f"y_{h}"].to_numpy())
                entry[f"mae_{h}_lgbm"] = float(np.mean(np.abs(d.loc[mm, f"yhat_{h}"] - d.loc[mm, f"y_{h}"])))
                entry[f"mae_{h}_persistence"] = float(np.mean(np.abs(d.loc[mm, "g0"] - d.loc[mm, f"y_{h}"])))
            de = d[np.isfinite(d["ev_hyper"].to_numpy())].reset_index(drop=True)
            ev = M.event_level(_event_records(de, glucose_by_rec, de["p_hyper"].to_numpy(), "hyper"),
                               bundle.thresholds["hyper"])
            entry["hyper_sensitivity"] = ev["sensitivity"]
            entry["hyper_false_alerts_per_day"] = ev["false_alerts_per_day"]
            subgroups[f"{col}={grp}"] = entry
    results["subgroups_test"] = subgroups

    _log("Robustness tests")
    rng = np.random.default_rng(SEED)
    robust = {}
    base_keys = set(zip(data["recording_id"], data["slot"]))
    for kind in ("drop10", "drop30", "gap60_daily", "noise5", "noise10", "noise20", "arnoise10"):
        parts = []
        for s in series.values():
            ps = _perturb(s, kind, rng)
            parts.append(pd.concat([build_features(ps, kp), build_targets(s)], axis=1))
        pdata = pd.concat(parts, ignore_index=True)
        in_base = np.array([k in base_keys for k in zip(pdata["recording_id"], pdata["slot"])])
        issuable = pdata["issuable"].to_numpy()
        entry = {"abstention_rate": float(1 - issuable[in_base].mean())}
        pdata = pdata[issuable & in_base].reset_index(drop=True)
        pout = bundle.predict(pdata)
        for h in (30, 60):
            mm = np.isfinite(pdata[f"y_{h}"].to_numpy())
            y = pdata.loc[mm, f"y_{h}"].to_numpy()
            entry[f"mae_{h}_lgbm"] = float(np.mean(np.abs(pout[f"yhat_{h}"][mm] - y)))
            entry[f"mae_{h}_persistence"] = float(np.mean(np.abs(pdata.loc[mm, "g0"].to_numpy() - y)))
            entry[f"coverage_{h}"] = float(np.mean((y >= pout[f"lo_{h}"][mm]) & (y <= pout[f"hi_{h}"][mm])))
        robust[kind] = entry
        _log(f"  {kind}: {entry}")
    results["robustness_test"] = robust

    imp = {}
    for h in (30, 60):
        booster = bundle.point[h]
        gain = pd.Series(booster.feature_importance("gain"), index=booster.feature_name())
        gain = (gain / gain.sum()).sort_values(ascending=False)
        pool = data[np.isfinite(data[f"y_{h}"].to_numpy())]
        sample = pool.sample(n=min(4000, len(pool)), random_state=SEED)
        contrib = bundle.contributions(sample, h).drop(columns="bias").abs().mean()
        groups = {g: float(contrib[[f for f in fs if f in contrib.index]].sum()) for g, fs in FEATURE_GROUPS.items()}
        imp[h] = {"gain_top": [{"feature": k, "share": float(v)} for k, v in gain.head(20).items()],
                  "shap_by_group_mgdl": groups}
    results["importance_test"] = imp

    now = dt.datetime.now().isoformat(timespec="seconds")
    results["meta"] = {
        "stage": "test",
        "evaluated_at": now,
        "git_commit": _git_commit(),
        "test_patients": int(data["patient_id"].nunique()),
        "test_recordings": int(data["recording_id"].nunique()),
        "issuable_rows": int(len(data)),
        "model_trained_at": bundle.meta.get("trained_at"),
        "model_version": bundle.meta.get("version", "1"),
        "reason": reason,
    }
    (RESULTS_DIR / "test.json").write_text(json.dumps(results, indent=2, default=float))
    pd.concat(pred_frames, ignore_index=True).to_parquet(RESULTS_DIR / "test_predictions.parquet", index=False)
    if not TEST_LOCK.exists():
        TEST_LOCK.write_text(json.dumps({"evaluated_at": now, "git_commit": _git_commit(),
                                         "note": "Test set scored once with the frozen bundle."}, indent=2))
    with RUN_LOG.open("a") as f:
        f.write(json.dumps({"stage": "test", "at": now, "commit": _git_commit(), "reason": reason}) + "\n")
    _log("Test stage done")
    return results
