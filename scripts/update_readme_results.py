"""Fill the README results section from results/benchmark.json.

Run after `python -m pratirup.cli report`. Everything between the RESULTS
markers in README.md is regenerated, so the README cannot drift from the
experiment outputs. Wording about differences follows the confidence interval.
"""

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
B = json.loads((ROOT / "results" / "benchmark.json").read_text())
E = B.get("external")
FM = B.get("foundation_model")
LABEL = {m["key"]: m["label"] for m in B["models"]}
SCORER = {m["key"]: m["label"] for m in B["event_scorers"]}


def f(x, d=1):
    return "—" if x is None else f"{x:.{d}f}"


def pct(x, d=1):
    return "—" if x is None else f"{x * 100:.{d}f}%"


def verdict(b: dict, better: str, worse: str) -> str:
    """Describe a bootstrap difference (a - b, negative = a better) from its CI."""
    lo, hi = b["ci95"]
    if hi < 0:
        return better
    if lo > 0:
        return worse
    return "no measurable difference"


def versions_table() -> str:
    v = B.get("versions") or {}
    a, b = v.get("v1"), v.get("latest")
    if not (a and b):
        return ""
    rows = ["| | v1 | **v2 (current)** |", "|---|---|---|"]
    for h in ("30", "60", "120"):
        rows.append(f"| MAE {h} min (mg/dL) | {f(a['mae'][h], 2)} | **{f(b['mae'][h], 2)}** |")
    rows.append(f"| 80% interval coverage, 60 min | {pct(a['coverage_60'])} | **{pct(b['coverage_60'])}** |")
    rows.append(f"| MAE 30 min with SD-10 random sensor noise (last value: {f(b['noise10_mae_30_persistence'], 1)}) | "
                f"{f(a['noise10_mae_30'], 1)} | **{f(b['noise10_mae_30'], 1)}** |")
    rows.append(f"| Alerts per patient-day | {f(a['alerts_per_day'], 1)} | **{f(b['alerts_per_day'], 1)}** |")
    rows.append(f"| Alert design | {a['alert_design']} | {b['alert_design']} |")
    return "\n".join(rows) + "\n\n" + "\n".join(f"- {c}" for c in v.get("changes", []))


def forecast_table() -> str:
    t = B["forecast"]["test"]
    rows = ["| Model | MAE 30 min | MAE 60 min | MAE 120 min* | RMSE 60 min | Parkes A+B 60 min |",
            "|---|---|---|---|---|---|"]
    for m in B["models"]:
        k = m["key"]
        bold = "**" if k == "lgbm[full]" else ""
        rows.append(f"| {bold}{LABEL[k]}{bold} | {f(t['30'][k]['mae'], 2)} | {f(t['60'][k]['mae'], 2)} | "
                    f"{f(t['120'][k]['mae'], 2)} | {f(t['60'][k]['rmse'], 2)} | {f(t['60'][k]['parkes']['A+B'], 1)}% |")
    if FM and "test" in FM:
        x = FM["test"]
        rows.append(f"| Chronos-Bolt small, zero-shot foundation model | {f(x['30']['mae'], 2)} | {f(x['60']['mae'], 2)} | "
                    f"{f(x['120']['mae'], 2)} | {f(x['60']['rmse'], 2)} | — |")
    return "\n".join(rows)


def boot_lines() -> str:
    out = []
    for h in ("30", "60", "120"):
        b = B["bootstrap_test"][h]["lgbm_full_vs_persistence"]
        out.append(f"- **{h} min:** {f(b['diff'], 2)} mg/dL vs last value carried forward (95% CI {f(b['ci95'][0], 2)} to {f(b['ci95'][1], 2)}).")
    g = B["bootstrap_test"]["60"]["lgbm_full_vs_gru_seq"]
    out.append(f"- Versus the tuned GRU at 60 min: {f(g['diff'], 2)} mg/dL (95% CI {f(g['ci95'][0], 2)} to {f(g['ci95'][1], 2)}): "
               + verdict(g, "Pratirup is slightly better", "the GRU is slightly better (about 1%, clinically negligible); "
                         "Pratirup serves LightGBM for exact attributions, conformal intervals and a CPU-only runtime") + ".")
    e = B["bootstrap_test"]["60"]["lgbm_full_vs_lgbm_cgm"]
    out.append(f"- Logs, clinical record and personal history added to CGM-only LightGBM at 60 min: {f(e['diff'], 2)} mg/dL "
               f"(95% CI {f(e['ci95'][0], 2)} to {f(e['ci95'][1], 2)}).")
    p = B["bootstrap_test"]["60"]["lgbm_full_personal_vs_lgbm_full"]
    out.append(f"- Online self-correction at 60 min: {f(p['diff'], 2)} mg/dL (95% CI {f(p['ci95'][0], 2)} to {f(p['ci95'][1], 2)}): "
               + verdict(p, "a small gain", "a small loss") + ".")
    pp = B.get("per_patient_test")
    if pp:
        x, y = pp["60"]["lgbm[full]"], pp["60"]["persistence"]
        out.append(f"- Per patient at 60 min (mean ± SD over the 20 test patients): MAE {f(x['mae_mean'], 1)} ± {f(x['mae_sd'], 1)} vs "
                   f"{f(y['mae_mean'], 1)} ± {f(y['mae_sd'], 1)} for last value; RMSE {f(x['rmse_mean'], 1)} ± {f(x['rmse_sd'], 1)}.")
    return "\n".join(out)


def interval_table() -> str:
    rows = ["| Horizon | Empirical coverage (nominal 80%) | Mean width (mg/dL) |", "|---|---|---|"]
    for h in ("30", "60", "120"):
        i = B["intervals"]["test"][h]["personal"]
        rows.append(f"| {h} min | {pct(i['coverage'])} | {f(i['mean_width'], 1)} |")
    return "\n".join(rows)


def policy_table() -> str:
    ap = B.get("alert_policy") or {}
    rows = ["| Cohort | Alerts / patient-day | False alerts / patient-day | PPV | < 70 caught (≥ 30 min ahead) | > 250 caught (≥ 30 min ahead) |",
            "|---|---|---|---|---|---|"]
    for name, key in (("Development (CV)", "dev"), ("**Held-out test**", "test"), ("CGMacros T2D (external)", "external_t2d")):
        r = ap.get(key)
        if not r:
            continue
        rows.append(f"| {name} | {f(r['alerts_per_day'], 2)} | {f(r['false_alerts_per_day'], 2)} | {pct(r['ppv'])} | "
                    f"{pct(r['hypo']['sensitivity'])} ({pct(r['hypo']['sensitivity_lead30'])}) of {r['hypo']['episodes']} | "
                    f"{pct(r['hyper2']['sensitivity'])} ({pct(r['hyper2']['sensitivity_lead30'])}) of {r['hyper2']['episodes']} |")
    return "\n".join(rows)


def event_table() -> str:
    names = {"hyper": "Rise above 180 within 60 min", "hyper2": "Rise above 250 within 60 min", "hypo": "Fall below 70 within 60 min"}
    rows = ["| Event | Scorer | Episodes | Sensitivity | ≥ 30 min warning | PPV | False alerts / day | AUPRC (prevalence) |",
            "|---|---|---|---|---|---|---|---|"]
    for kind in ("hypo", "hyper2", "hyper"):
        for s in ("classifier", "trend_rule"):
            v = B["events"]["test"][kind][s]
            ev, sm = v["event"], v["sample"]
            rows.append(f"| {names[kind] if s == 'classifier' else ''} | {SCORER[s]} | {ev['episodes']} | {pct(ev['sensitivity'])} | "
                        f"{pct(ev['sensitivity_lead30'])} | {pct(ev['ppv'])} | {f(ev['false_alerts_per_day'], 2)} | "
                        f"{f(sm['auprc'], 3)} ({f(sm['prevalence'], 3)}) |")
    return "\n".join(rows)


def robustness_table() -> str:
    names = {"drop10": "10% of readings missing", "drop30": "30% of readings missing", "gap60_daily": "1-h gap every day",
             "noise5": "Random noise, SD 5 mg/dL", "noise10": "Random noise, SD 10 mg/dL", "noise20": "Random noise, SD 20 mg/dL",
             "arnoise10": "Correlated noise (AR(1), rho 0.7), SD 10 mg/dL"}
    rows = ["| Perturbation | No forecast issued† | MAE 30 min (Pratirup / last value) | MAE 60 min (Pratirup / last value) | Coverage 60 min |",
            "|---|---|---|---|---|"]
    for k, v in B["robustness_test"].items():
        rows.append(f"| {names.get(k, k)} | {pct(v['abstention_rate'])} | {f(v['mae_30_lgbm'], 1)} / {f(v['mae_30_persistence'], 1)} | "
                    f"{f(v['mae_60_lgbm'], 1)} / {f(v['mae_60_persistence'], 1)} | {pct(v['coverage_60'])} |")
    return "\n".join(rows) + "\n\n† Includes slots whose reading was removed and slots with < 8 readings in the last 3 h."


def external_table() -> str:
    if not E:
        return "_External evaluation not run._"
    rows = ["| Group (CGMacros) | People | MAE 60 min: Pratirup | GRU | Last value | Interval coverage |", "|---|---|---|---|---|---|"]
    for g in ("t2d", "prediabetes", "healthy", "all"):
        e = E["transfer"]["60"][g]
        m = e["models"]
        rows.append(f"| {g} | {e['subjects']} | {f(m['lgbm[full]']['mae'], 2)} | {f(m['gru_seq']['mae'], 2)} | "
                    f"{f(m['persistence']['mae'], 2)} | {pct(e['interval_coverage'])} |")
    b = E["wearables"]["60"]["bootstrap_wearable_minus_cgm"]
    rows.append("")
    rows.append(f"Wearable experiment (inside CGMacros, 5-fold participant-grouped CV): adding Fitbit heart rate and activity energy "
                f"changed 60-min MAE by {f(b['diff'], 2)} mg/dL (95% CI {f(b['ci95'][0], 2)} to {f(b['ci95'][1], 2)}): "
                + verdict(b, "a small gain", "a small loss") + ".")
    return "\n".join(rows)


def section() -> str:
    m = B["meta"]
    v = B.get("versions") or {}
    return f"""
All numbers below are generated from [`results/benchmark.json`](results/benchmark.json) by `scripts/update_readme_results.py`.

- **Test set:** {m['split']['test_patients']} held-out patients.
- **Model:** v{v.get('current', '1')}, scored {m['test_stage']['evaluated_at']}.
- **v1 results:** kept in [`results/v1/`](results/v1/). The reason for the re-evaluation is logged in [`results/runs.jsonl`](results/runs.jsonl).
- **Confidence intervals:** patient-level bootstrap.

#### v1 → v2

{versions_table()}

#### Forecast accuracy (held-out patients, mg/dL)

{forecast_table()}

\\* 120 min is exploratory. The brief's "2 hours in advance" example was evaluated directly rather than assumed.

{boot_lines()}

#### Uncertainty

{interval_table()}

#### Alerts: consolidated policy (what a care team receives)

- **Scope:** one stream per patient, for predicted < 70 and > 250 mg/dL within 60 min.
- **Cooldown:** shared, 60 min. A predicted low can override it.
- **Thresholds:** set on development patients for ≤ 1 false alert per patient-day.

{policy_table()}

#### Per-event classifiers (each tuned alone; they feed the policy and the worklist ranking)

{event_table()}

#### Robustness (inputs perturbed, true future readings unchanged)

{robustness_table()}

#### External validation: CGMacros (frozen model, different country, device and setting)

{external_table()}
"""


readme = (ROOT / "README.md").read_text(encoding="utf-8")
new = re.sub(r"(<!-- RESULTS:START -->)(.*?)(<!-- RESULTS:END -->)", lambda mm: mm.group(1) + section() + mm.group(3),
             readme, flags=re.S)
(ROOT / "README.md").write_text(new, encoding="utf-8")
print("README results section updated")
