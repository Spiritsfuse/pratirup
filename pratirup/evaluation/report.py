"""Merge benchmark stages into results/benchmark.json and render figures.

Every number shown in the app's evidence page, the README and the deck comes
from this file, which is generated from the experiment outputs.
"""

from __future__ import annotations

import datetime as dt
import json

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd

from pratirup.config import DATA_PROCESSED, HORIZONS_MIN, RESULTS_DIR
from pratirup.evaluation.metrics import parkes_zones_type2
from pratirup.twin.labels import FEATURE_LABELS

MODELS = [
    ("persistence", "Last value carried forward", "baseline"),
    ("kalman_trend", "Kalman damped trend", "baseline"),
    ("ridge_ar", "Linear autoregression (ridge)", "baseline"),
    ("gru_seq", "GRU sequence network", "comparison"),
    ("lgbm[cgm]", "LightGBM: CGM only", "ablation"),
    ("lgbm[cgm+events]", "LightGBM: CGM + logs", "ablation"),
    ("lgbm[cgm+events+ehr]", "LightGBM: CGM + logs + clinical record", "ablation"),
    ("lgbm[full]", "Pratirup: + personal history", "pratirup"),
    ("lgbm[full]+personal", "Pratirup + online self-correction", "pratirup"),
    ("ensemble[lgbm+gru]", "Average of LightGBM and GRU (not deployed)", "comparison"),
]
EVENT_SCORERS = [
    ("classifier", "Pratirup calibrated classifier"),
    ("forecast_rule", "Pratirup forecast crosses threshold"),
    ("trend_rule", "Rate-of-change extrapolation"),
    ("kalman_rule", "Kalman trend extrapolation"),
]
FIG = RESULTS_DIR / "figures"
INK, MUTED, GRID = "#17242b", "#55666f", "#d9e1e5"
C_BASE, C_ABL, C_MAIN, C_GRU = "#9aa9b1", "#7fb3c2", "#0d5f73", "#b28a4a"


def _style(ax):
    ax.spines[["top", "right"]].set_visible(False)
    ax.spines[["left", "bottom"]].set_color(GRID)
    ax.tick_params(colors=MUTED, labelsize=9)
    ax.yaxis.grid(True, color=GRID, lw=0.6)
    ax.set_axisbelow(True)


def _color(kind):
    return {"baseline": C_BASE, "ablation": C_ABL, "pratirup": C_MAIN, "comparison": C_GRU}[kind]


def fig_mae(test: dict) -> str:
    fig, axes = plt.subplots(1, 3, figsize=(12, 4.2), sharey=False)
    for ax, h in zip(axes, HORIZONS_MIN):
        d = test["forecast_test"][str(h)]
        keys = [m for m in MODELS if m[0] in d]
        vals = [d[k]["mae"] for k, _, _ in keys]
        ax.barh(range(len(keys)), vals, color=[_color(k) for _, _, k in keys])
        ax.set_yticks(range(len(keys)), [lbl for _, lbl, _ in keys] if h == 30 else [""] * len(keys), fontsize=8.5)
        for i, v in enumerate(vals):
            ax.text(v + 0.3, i, f"{v:.1f}", va="center", fontsize=8, color=INK)
        ax.invert_yaxis()
        ax.set_title(f"+{h} min" + (" (exploratory)" if h == 120 else ""), fontsize=10, color=INK, loc="left")
        ax.set_xlabel("MAE, mg/dL (lower is better)", fontsize=8.5, color=MUTED)
        _style(ax)
        ax.xaxis.grid(True, color=GRID, lw=0.6)
        ax.yaxis.grid(False)
    fig.suptitle("Forecast error on 20 held-out patients", x=0.01, ha="left", fontsize=12, color=INK)
    fig.tight_layout()
    path = FIG / "mae_by_horizon.png"
    fig.savefig(path, dpi=160)
    plt.close(fig)
    return path.name


def fig_parkes(pred: pd.DataFrame) -> str:
    d = pred[pred["horizon"] == 60]
    ref, test = d["y"].to_numpy(), d["lgbm[full]+personal"].to_numpy()
    z = parkes_zones_type2(ref, test)
    fig, ax = plt.subplots(figsize=(5.2, 5.2))
    colors = {"A": "#2e8b57", "B": "#c98a00", "C": "#d2691e", "D": "#c0392b", "E": "#8e1f16"}
    for k in "EDCBA":
        m = z == k
        ax.scatter(ref[m], test[m], s=2, alpha=0.35, color=colors[k], label=f"{k}: {m.mean() * 100:.1f}%")
    ax.plot([0, 450], [0, 450], color=MUTED, lw=0.8)
    ax.set_xlim(40, 450)
    ax.set_ylim(40, 450)
    ax.set_xlabel("Actual glucose at +60 min, mg/dL", fontsize=9, color=MUTED)
    ax.set_ylabel("Forecast, mg/dL", fontsize=9, color=MUTED)
    ax.set_title("Parkes error grid (type 2), +60 min", fontsize=11, color=INK, loc="left")
    ax.legend(markerscale=5, fontsize=8, frameon=False, loc="upper left")
    _style(ax)
    fig.tight_layout()
    path = FIG / "parkes_60min.png"
    fig.savefig(path, dpi=160)
    plt.close(fig)
    return path.name


def fig_calibration(test: dict) -> str:
    fig, axes = plt.subplots(1, 3, figsize=(11, 3.8))
    names = {"hyper": "> 180 within 60 min", "hyper2": "> 250 within 60 min", "hypo": "< 70 within 60 min"}
    for ax, kind in zip(axes, ("hyper", "hyper2", "hypo")):
        cal = test["events_test"][kind]["classifier"]["calibration"]
        p = [c["p_mean"] for c in cal]
        o = [c["observed"] for c in cal]
        mx = max(max(p), max(o)) * 1.1
        ax.plot([0, mx], [0, mx], color=MUTED, lw=0.8, ls="--")
        ax.plot(p, o, "o-", color=C_MAIN, ms=4)
        ax.set_xlim(0, mx)
        ax.set_ylim(0, mx)
        ax.set_title(names[kind], fontsize=10, color=INK, loc="left")
        ax.set_xlabel("Predicted probability", fontsize=8.5, color=MUTED)
        ax.set_ylabel("Observed frequency", fontsize=8.5, color=MUTED)
        _style(ax)
    fig.suptitle("Calibration of event probabilities, held-out patients", x=0.01, ha="left", fontsize=12, color=INK)
    fig.tight_layout()
    path = FIG / "calibration.png"
    fig.savefig(path, dpi=160)
    plt.close(fig)
    return path.name


def fig_trace(pred: pd.DataFrame) -> str:
    d = pred[pred["horizon"] == 60].copy()
    rid = d.groupby("recording_id")["y"].std().sort_values().index[len(d["recording_id"].unique()) // 2]
    d = d[d["recording_id"] == rid].sort_values("slot")
    d = d.iloc[96 * 2 : 96 * 3 + 4] if len(d) > 96 * 3 else d.iloc[:100]
    t = pd.to_datetime(d["ts"]) + pd.Timedelta(minutes=60)
    fig, ax = plt.subplots(figsize=(11, 3.6))
    ax.axhspan(70, 180, color="#2e8b57", alpha=0.08)
    ax.fill_between(t, d["lo"], d["hi"], color=C_MAIN, alpha=0.15, label="80% interval")
    ax.plot(t, d["y"], color=INK, lw=1.6, label="Actual CGM")
    ax.plot(t, d["lgbm[full]+personal"], color=C_MAIN, lw=1.2, ls="--", label="Forecast made 60 min earlier")
    ax.plot(t, d["persistence"], color=C_BASE, lw=1, ls=":", label="Last value carried forward")
    ax.set_ylabel("mg/dL", fontsize=9, color=MUTED)
    ax.set_title(f"One held-out day: 60-minute forecasts vs what happened ({rid.split('_')[0]})", fontsize=11, color=INK, loc="left")
    ax.legend(fontsize=8, frameon=False, ncol=4, loc="upper left")
    _style(ax)
    fig.tight_layout()
    path = FIG / "example_trace.png"
    fig.savefig(path, dpi=160)
    plt.close(fig)
    return path.name


def fig_ablation(test: dict) -> str:
    fig, ax = plt.subplots(figsize=(7.5, 3.6))
    ladder = ["lgbm[cgm]", "lgbm[cgm+events]", "lgbm[cgm+events+ehr]", "lgbm[full]", "lgbm[full]+personal"]
    labels = ["CGM", "+ logs", "+ clinical\nrecord", "+ personal\nhistory", "+ online\nself-correction"]
    for h, c in ((30, C_ABL), (60, C_MAIN)):
        v = [test["forecast_test"][str(h)][k]["mae"] for k in ladder]
        ax.plot(labels, v, "o-", color=c, label=f"+{h} min")
        for x, y in zip(labels, v):
            ax.text(x, y + 0.25, f"{y:.2f}", ha="center", fontsize=8, color=INK)
    ax.set_ylabel("MAE, mg/dL", fontsize=9, color=MUTED)
    ax.set_title("What each data stream adds (held-out patients)", fontsize=11, color=INK, loc="left")
    ax.legend(frameon=False, fontsize=8)
    _style(ax)
    fig.tight_layout()
    path = FIG / "ablation.png"
    fig.savefig(path, dpi=160)
    plt.close(fig)
    return path.name


def _summary(test: dict | None) -> dict | None:
    if not test:
        return None
    ft = test["forecast_test"]
    ev = test["events_test"]
    burden = sum(ev[k]["classifier"]["event"]["alerts_per_day"] for k in ev)
    pol = test.get("alert_policy_test")
    return {
        "model_version": test["meta"].get("model_version", "1"),
        "evaluated_at": test["meta"]["evaluated_at"],
        "mae": {h: ft[h]["lgbm[full]"]["mae"] for h in ft},
        "mae_persistence": {h: ft[h]["persistence"]["mae"] for h in ft},
        "coverage_60": test["intervals_test"]["60"]["personal"]["coverage"],
        "noise10_mae_30": test["robustness_test"]["noise10"]["mae_30_lgbm"],
        "noise10_mae_30_persistence": test["robustness_test"]["noise10"]["mae_30_persistence"],
        "alerts_per_day": pol["alerts_per_day"] if pol else burden,
        "false_alerts_per_day": pol["false_alerts_per_day"] if pol else None,
        "alert_design": "consolidated (<70 and >250, shared cooldown)" if pol else "three independent streams",
    }


def _versions(test: dict | None) -> dict:
    v1_path = RESULTS_DIR / "v1" / "test.json"
    v1 = json.loads(v1_path.read_text()) if v1_path.exists() else None
    current = _summary(test)
    return {
        "current": current["model_version"] if current else None,
        "v1": _summary(v1) if v1 and (not current or current["model_version"] != "1") else None,
        "latest": current,
        "changes": [
            "v2: every LightGBM model also trains on noise-augmented copies of the development recordings, with a "
            "signal-roughness feature (selected on development data only: results/experiments/noise_robustness_dev.json).",
            "v2: one consolidated alert stream per patient for predicted <70 and >250 mg/dL with a shared 60-min "
            "cooldown, thresholds set on development data for <= 1 false alert per patient-day; '>180' became a "
            "ranking signal instead of an interruptive alert.",
        ],
    }


def main() -> None:
    dev = json.loads((RESULTS_DIR / "dev_cv.json").read_text())
    test_path = RESULTS_DIR / "test.json"
    test = json.loads(test_path.read_text()) if test_path.exists() else None
    ext_path = RESULTS_DIR / "external.json"
    external = json.loads(ext_path.read_text()) if ext_path.exists() else None
    split = json.loads((DATA_PROCESSED / "split.json").read_text())
    out: dict = {
        "meta": {
            "generated_at": dt.datetime.now().isoformat(timespec="seconds"),
            "dev_stage": dev["meta"],
            "test_stage": test["meta"] if test else None,
            "dataset": "ShanghaiT2DM (Zhao et al., Scientific Data 2023), 100 people with type 2 diabetes, 109 recordings, CGM every 15 min",
            "split": {"unit": "patient", "dev_patients": split["n_dev"], "test_patients": split["n_test"],
                      "folds": 5, "stratified_by": split["stratified_by"], "seed": split["seed"]},
            "protocol": [
                "All choices (Kalman parameters, hyperparameters, conformal adjustment, personalisation, calibration, "
                "alert thresholds) were made with 5-fold patient-grouped cross-validation on the 80 development patients.",
                "Early stopping used held-out development patients, never the fold being scored.",
                "The 20 test patients were scored once with the frozen model; see results/TEST_LOCK.json.",
                "Event thresholds are fixed by consensus (Battelino 2019): 70, 180 and 250 mg/dL, sustained >= 15 min.",
            ],
        },
        "models": [{"key": k, "label": lbl, "kind": kind} for k, lbl, kind in MODELS],
        "event_scorers": [{"key": k, "label": lbl} for k, lbl in EVENT_SCORERS],
        "kalman": dev["kalman"],
        "lgbm_tuning": dev["lgbm_tuning"],
        "gru": dev.get("gru"),
        "forecast": {"dev_cv": {h: {k: v for k, v in d.items() if not k.startswith("_")} for h, d in dev["forecast_dev_cv"].items()}},
        "intervals": {"dev_cv": {h: d["_interval_conformal"] for h, d in dev["forecast_dev_cv"].items()}},
        "events": {"dev_cv": dev["events_dev_cv"]},
        "thresholds": dev["thresholds"],
        "personalisation": {"selected": dev["personalisation"]["selected"]},
        "figures": [],
    }
    if test:
        out["forecast"]["test"] = test["forecast_test"]
        out["intervals"]["test"] = test["intervals_test"]
        out["bootstrap_test"] = test["bootstrap_test"]
        out["events"]["test"] = test["events_test"]
        burden = {k: test["events_test"][k]["classifier"]["event"]["alerts_per_day"] for k in test["events_test"]}
        out["alert_burden_test"] = {"by_kind": burden, "total_alerts_per_day": float(sum(burden.values()))}
        out["personalisation"]["test"] = {
            h: {"mae_population": test["forecast_test"][h]["lgbm[full]"]["mae"],
                "mae_personal": test["forecast_test"][h]["lgbm[full]+personal"]["mae"]} for h in test["forecast_test"]}
        out["robustness_test"] = test["robustness_test"]
        out["subgroups_test"] = test["subgroups_test"]
        imp = test["importance_test"]
        for h in imp:
            for item in imp[h]["gain_top"]:
                item["label"] = FEATURE_LABELS.get(item["feature"], item["feature"])
        out["importance_test"] = imp
        FIG.mkdir(parents=True, exist_ok=True)
        pred = pd.read_parquet(RESULTS_DIR / "test_predictions.parquet")
        out["figures"] = [fig_mae(test), fig_parkes(pred), fig_calibration(test), fig_trace(pred), fig_ablation(test)]
        per_patient = {}
        for h, d in pred.groupby("horizon"):
            rows = {}
            for k in ("persistence", "lgbm[full]", "lgbm[full]+personal"):
                e = d.assign(err=d[k] - d["y"]).groupby("patient_id")["err"]
                mae, rmse = e.apply(lambda x: x.abs().mean()), e.apply(lambda x: (x ** 2).mean() ** 0.5)
                rows[k] = {"mae_mean": float(mae.mean()), "mae_sd": float(mae.std()),
                           "rmse_mean": float(rmse.mean()), "rmse_sd": float(rmse.std())}
            per_patient[str(int(h))] = rows
        out["per_patient_test"] = per_patient
    if external:
        out["external"] = external
    fm_path = RESULTS_DIR / "experiments" / "foundation_model_zero_shot.json"
    if fm_path.exists():
        out["foundation_model"] = json.loads(fm_path.read_text())
    nr_path = RESULTS_DIR / "experiments" / "noise_robustness_dev.json"
    if nr_path.exists():
        out["noise_experiment_dev"] = json.loads(nr_path.read_text())
    out["alert_policy"] = {"dev": dev.get("alert_policy_dev"), "test": (test or {}).get("alert_policy_test"),
                           "external_t2d": (external or {}).get("alert_policy_t2d")}
    out["versions"] = _versions(test)
    (RESULTS_DIR / "benchmark.json").write_text(json.dumps(out, indent=2, default=float))
    print(f"Wrote {RESULTS_DIR / 'benchmark.json'} with figures {out['figures']}")


if __name__ == "__main__":
    main()
