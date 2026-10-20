"""Fill the README results section from results/benchmark.json.

Run after `python -m pratirup.cli report`. Everything between the RESULTS
markers in README.md is regenerated, so the README can never drift from the
experiment outputs.
"""

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
B = json.loads((ROOT / "results" / "benchmark.json").read_text())
E = B.get("external")
LABEL = {m["key"]: m["label"] for m in B["models"]}
SCORER = {m["key"]: m["label"] for m in B["event_scorers"]}


def f(x, d=1):
    return "—" if x is None else f"{x:.{d}f}"


def forecast_table() -> str:
    t = B["forecast"]["test"]
    rows = ["| Model | MAE 30 min | MAE 60 min | MAE 120 min* | RMSE 60 min | Parkes A+B 60 min |",
            "|---|---|---|---|---|---|"]
    for m in B["models"]:
        k = m["key"]
        bold = "**" if k == "lgbm[full]" else ""
        rows.append(f"| {bold}{LABEL[k]}{bold} | {f(t['30'][k]['mae'], 2)} | {f(t['60'][k]['mae'], 2)} | "
                    f"{f(t['120'][k]['mae'], 2)} | {f(t['60'][k]['rmse'], 2)} | {f(t['60'][k]['parkes']['A+B'], 1)}% |")
    return "\n".join(rows)


def boot_lines() -> str:
    out = []
    for h in ("30", "60", "120"):
        b = B["bootstrap_test"][h]["lgbm_full_vs_persistence"]
        out.append(f"- **{h} min:** {f(b['diff'], 2)} mg/dL vs last value carried forward (95% CI {f(b['ci95'][0], 2)} to {f(b['ci95'][1], 2)}).")
    g = B["bootstrap_test"]["60"]["lgbm_full_vs_gru_seq"]
    p = B["bootstrap_test"]["60"]["lgbm_full_personal_vs_lgbm_full"]
    e = B["bootstrap_test"]["60"]["lgbm_full_vs_lgbm_cgm"]
    out.append(f"- Versus the GRU at 60 min: {f(g['diff'], 2)} mg/dL (95% CI {f(g['ci95'][0], 2)} to {f(g['ci95'][1], 2)}), i.e. no measurable difference.")
    out.append(f"- Adding logs, clinical record and personal history to CGM-only LightGBM at 60 min: {f(e['diff'], 2)} mg/dL (95% CI {f(e['ci95'][0], 2)} to {f(e['ci95'][1], 2)}).")
    out.append(f"- Online self-correction at 60 min: {f(p['diff'], 2)} mg/dL (95% CI {f(p['ci95'][0], 2)} to {f(p['ci95'][1], 2)}), i.e. no measurable gain.")
    return "\n".join(out)


def interval_table() -> str:
    rows = ["| Horizon | Empirical coverage (nominal 80%) | Mean width (mg/dL) |", "|---|---|---|"]
    for h in ("30", "60", "120"):
        i = B["intervals"]["test"][h]["personal"]
        rows.append(f"| {h} min | {f(i['coverage'] * 100, 1)}% | {f(i['mean_width'], 1)} |")
    return "\n".join(rows)


def event_table() -> str:
    names = {"hyper": "Rise above 180 mg/dL within 60 min", "hyper2": "Rise above 250 mg/dL within 60 min",
             "hypo": "Fall below 70 mg/dL within 60 min"}
    rows = ["| Event | Scorer | Episodes | Sensitivity | ≥30 min warning | PPV | False alerts / patient-day | AUPRC (prevalence) |",
            "|---|---|---|---|---|---|---|---|"]
    for kind in ("hyper", "hyper2", "hypo"):
        for s in ("classifier", "trend_rule"):
            v = B["events"]["test"][kind][s]
            ev, sm = v["event"], v["sample"]
            rows.append(f"| {names[kind] if s == 'classifier' else ''} | {SCORER[s]} | {ev['episodes']} | {f(ev['sensitivity'] * 100, 1)}% | "
                        f"{f(ev['sensitivity_lead30'] * 100, 1)}% | {f(ev['ppv'] * 100, 1)}% | {f(ev['false_alerts_per_day'], 2)} | "
                        f"{f(sm['auprc'], 3)} ({f(sm['prevalence'], 3)}) |")
    return "\n".join(rows)


def robustness_table() -> str:
    names = {"drop10": "10% of readings missing", "drop30": "30% of readings missing", "gap60_daily": "1-h gap every day",
             "noise10": "±10 mg/dL random noise", "noise20": "±20 mg/dL random noise"}
    rows = ["| Perturbation | No forecast issued (missing reading or < 8 readings in 3 h) | MAE 30 min (Pratirup / last value) | MAE 60 min (Pratirup / last value) | Coverage 60 min |",
            "|---|---|---|---|---|"]
    for k, v in B["robustness_test"].items():
        rows.append(f"| {names[k]} | {f(v['abstention_rate'] * 100, 1)}% | {f(v['mae_30_lgbm'], 1)} / {f(v['mae_30_persistence'], 1)} | "
                    f"{f(v['mae_60_lgbm'], 1)} / {f(v['mae_60_persistence'], 1)} | {f(v['coverage_60'] * 100, 1)}% |")
    return "\n".join(rows)


def external_table() -> str:
    if not E:
        return "_External evaluation not run._"
    rows = ["| Group (CGMacros) | People | MAE 60 min: Pratirup | GRU | Last value | Interval coverage |", "|---|---|---|---|---|---|"]
    for g in ("t2d", "prediabetes", "healthy", "all"):
        e = E["transfer"]["60"][g]
        m = e["models"]
        rows.append(f"| {g} | {e['subjects']} | {f(m['lgbm[full]']['mae'], 2)} | {f(m['gru_seq']['mae'], 2)} | "
                    f"{f(m['persistence']['mae'], 2)} | {f(e['interval_coverage'] * 100, 1)}% |")
    w = E["wearables"]["60"]
    b = w["bootstrap_wearable_minus_cgm"]
    t2 = E["hyper_alerts"]["t2d"]["event"]
    rows.append("")
    rows.append(f"Rise-above-180 alerts in the 14 CGMacros participants with T2D: sensitivity {f(t2['sensitivity'] * 100, 1)}%, "
                f"PPV {f(t2['ppv'] * 100, 1)}%, {f(t2['false_alerts_per_day'], 2)} false alerts per patient-day.")
    rows.append("")
    rows.append(f"Wearable experiment (inside CGMacros, 5-fold participant-grouped CV): adding Fitbit heart rate and activity energy "
                f"changed 60-min MAE by {f(b['diff'], 2)} mg/dL (95% CI {f(b['ci95'][0], 2)} to {f(b['ci95'][1], 2)}): no measurable benefit.")
    return "\n".join(rows)


def section() -> str:
    m = B["meta"]
    burden = B["alert_burden_test"]
    return f"""
All numbers below are generated from [`results/benchmark.json`](results/benchmark.json) by `scripts/update_readme_results.py`.
Test set: {m['split']['test_patients']} held-out patients, scored once on {m['test_stage']['evaluated_at']} (see [`results/TEST_LOCK.json`](results/TEST_LOCK.json)).
Confidence intervals come from a patient-level bootstrap.

#### Forecast accuracy (held-out patients, mg/dL)

{forecast_table()}

\\* 120 min is exploratory; the brief's "2 hours in advance" example was evaluated directly rather than assumed.

{boot_lines()}

#### Uncertainty

{interval_table()}

#### Early warning (event level, 60-min refractory, thresholds fixed on development patients)

{event_table()}

Total alert load across the three alert types: {f(burden['total_alerts_per_day'], 1)} alerts per patient-day. This is too many for routine use (see Limitations).

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
