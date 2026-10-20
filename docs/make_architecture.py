"""Render the system architecture diagram (PDF + PNG) from code.

Run: python docs/make_architecture.py
Every box corresponds to a module in this repository; the legend separates
real data, model inference, simulation and clinician interaction.
"""

from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import FancyArrowPatch, FancyBboxPatch

OUT = Path(__file__).resolve().parent
INK, MUTED, LINE = "#15232a", "#56676f", "#b9c6cc"
REAL, MODEL, SIM, CLIN, STORE = "#e3f1e8", "#dcecf1", "#f7ecd6", "#ece6f6", "#eef1f3"
REAL_E, MODEL_E, SIM_E, CLIN_E, STORE_E = "#2e8b57", "#0d5f73", "#c98a00", "#6b4fa3", "#7d8b92"

fig, ax = plt.subplots(figsize=(16.5, 10.2))
ax.set_xlim(0, 165)
ax.set_ylim(0, 102)
ax.axis("off")


def box(x, y, w, h, title, lines, fill, edge, mod=None, dashed=False, fs=8.2):
    p = FancyBboxPatch((x, y), w, h, boxstyle="round,pad=0.4,rounding_size=1.2", fc=fill, ec=edge, lw=1.4,
                       ls="--" if dashed else "-")
    ax.add_patch(p)
    ax.text(x + 1.4, y + h - 2.2, title, fontsize=10.5, fontweight="bold", color=INK, va="top")
    for i, ln in enumerate(lines):
        ax.text(x + 1.4, y + h - 5.6 - i * 2.7, ln, fontsize=fs, color=INK, va="top")
    if mod:
        ax.text(x + w - 1.0, y + 0.9, mod, fontsize=6.8, color=MUTED, ha="right", va="bottom", family="monospace")


def arrow(x1, y1, x2, y2, label=None, color=MUTED, rad=0.0, lx=0, ly=0):
    a = FancyArrowPatch((x1, y1), (x2, y2), arrowstyle="-|>", mutation_scale=12, lw=1.2, color=color,
                        connectionstyle=f"arc3,rad={rad}")
    ax.add_patch(a)
    if label:
        ax.text((x1 + x2) / 2 + lx, (y1 + y2) / 2 + ly, label, fontsize=7.4, color=color, ha="center",
                bbox=dict(fc="white", ec="none", pad=0.6))


ax.text(1, 100, "Pratirup · system architecture (as built)", fontsize=16, fontweight="bold", color=INK, va="top")
ax.text(1, 96.2, "Glucose digital twin for type 2 diabetes care teams · research prototype · Team Aflatoon, Scaler School of Technology",
        fontsize=9.5, color=MUTED, va="top")

# --- Data sources
box(1, 66, 33, 24, "Static / historical stream",
    ["ShanghaiT2DM clinical record (real,", "de-identified, CC BY 4.0): age, sex, BMI,",
     "diabetes duration, HbA1c, C-peptide, lipids,", "eGFR, complications, comorbidities,",
     "glucose-lowering drugs. Genetic markers:", "not recorded (shown as absent)."],
    REAL, REAL_E, "pratirup/data/shanghai.py")
box(1, 36, 33, 26, "Dynamic stream",
    ["Real CGM, every 15 min (Libre H), from", "held-out patients; insulin doses, oral",
     "agents, pump rates and meals as timed", "logs. Replayed on a demo clock, or",
     "streamed reading-by-reading into the", "live twin (device simulator or", "POST /api/live/{id}/readings)."],
    REAL, REAL_E, "pratirup/data/vocab.py")
box(1, 8, 33, 23, "External validation (offline)",
    ["CGMacros, PhysioNet (CC BY-NC-SA 4.0):", "45 US adults, healthy / prediabetes /",
     "T2D; Libre Pro + Fitbit HR and METs.", "Frozen-model transfer test and", "wearable experiment. Not shipped."],
    REAL, REAL_E, "pratirup/evaluation/external.py", dashed=True)

# --- Normalisation
box(40, 66, 30, 24, "Normalise and validate",
    ["FHIR R4 bundle per record", "(Patient, Condition, Observation,", "MedicationStatement); 15-min grid;",
     "range and order checks; free-text", "drug and diet parsing; FHIR", "dataAbsentReason for genetics."],
    STORE, STORE_E, "pratirup/data/fhir.py")
box(40, 36, 30, 26, "Causal features",
    ["Built only from data at or before", "the forecast time (leakage test).",
     "CGM lags, rates, Kalman state;", "meals, insulin on board, oral agents;", "clinical record; personal",
     "time-of-day profile."],
    MODEL, MODEL_E, "pratirup/features.py")

# --- Twin engine
box(76, 30, 47, 60, "Digital twin engine (per patient)", [], MODEL, MODEL_E, "pratirup/twin/engine.py")
box(78.5, 72.8, 42, 13.2, "Patient state",
    ["clinical context · Kalman level, rate, uncertainty", "event context · personal profile · model trust",
     "data quality"], "white", MODEL_E, fs=7.6)
box(78.5, 57.5, 20.5, 13, "Forecaster",
    ["LightGBM", "+30 / +60 / +120 min", "conformal 80% interval"], "white", MODEL_E, fs=7.2)
box(100, 57.5, 20.5, 13, "Event risk",
    ["calibrated P(>180, >250,", "<70 within 60 min)", "alert: dev-set threshold"], "white", MODEL_E, fs=7.2)
box(78.5, 43, 20.5, 12, "Self-correction",
    ["EWM of this patient's", "resolved forecast errors"], "white", MODEL_E, fs=7.2)
box(100, 43, 20.5, 12, "Abstention",
    ["< 8 readings in 3 h, or", "last reading > 30 min old"], "white", MODEL_E, fs=7.2)
box(78.5, 31.5, 42, 9.5, "Forecast ledger",
    ["every forecast stored, scored at its target time"], "white", MODEL_E, fs=7.6)
arrow(99.5, 73.5, 89, 70.9, color=MODEL_E)
arrow(99.5, 73.5, 110, 70.9, color=MODEL_E)
arrow(88.7, 57.5, 88.7, 55.4, color=MODEL_E)
arrow(88.7, 41.4, 88.7, 43, color=MODEL_E)
ax.text(90, 41.9, "residuals", fontsize=7, color=MODEL_E)

# --- Sensitivity
box(76, 8, 46, 17, "What-if (model sensitivity)",
    ["Change one logged input (add or remove a meal / insulin),", "rerun the same feature builder and model, compare.",
     "Associational, not causal; out-of-range inputs flagged.", "No physiological simulator is claimed."],
    SIM, SIM_E, "POST /api/patients/{id}/sensitivity")

# --- Storage / API
box(128, 56, 36, 34, "Persistence and API",
    ["SQLite: recording, observation, event,", "twin_state, forecast (ledger)",
     "", "FastAPI: /worklist, /patients/{id}/twin,", "/ledger, /sensitivity, /live/*,",
     "/evaluation, /meta", "", "Docker: model + open data +", "results; no secrets; offline"],
    STORE, STORE_E, "pratirup/api/")
box(128, 22, 36, 30, "Clinician web app",
    ["React + TypeScript", "Worklist (priority by consensus", "targets + predicted risk) -> Patient twin",
     "(CGM, forecast band, past forecasts", "vs reality, drivers) -> Ledger ->", "What-if -> FHIR record;",
     "Live stream; Evidence (all metrics", "read from results/benchmark.json)"],
    CLIN, CLIN_E, "web/")
box(128, 3, 36, 16, "Evaluation pipeline (offline)",
    ["5-fold patient-grouped CV on 80 dev patients;", "20 test patients scored once (lock file);",
     "baselines, ablations, GRU, robustness;", "CGMacros external test"], STORE, STORE_E, None, fs=7.6)

# --- arrows between columns
arrow(34, 78, 40, 78)
arrow(34, 49, 40, 49)
arrow(70, 78, 76, 80, "clinical context")
arrow(70, 49, 76, 64, "feature row")
arrow(123, 62, 128, 62)
ax.text(125.5, 63.2, "state,\nforecasts,\nalerts", fontsize=7, color=MUTED, ha="center", va="bottom")
arrow(146, 56, 146, 52, "JSON")
arrow(128, 26, 122, 17, color=SIM_E)
ax.text(124.6, 13.8, "what-if\nrequest", fontsize=7, color=SIM_E, ha="center")
arrow(98, 25, 98, 30, color=SIM_E)
arrow(146, 19, 146, 22, color=MUTED)
ax.text(147, 20, "benchmark.json", fontsize=7, color=MUTED, va="center")

# legend
lx, ly = 40, 4
for i, (fill, edge, label) in enumerate([(REAL, REAL_E, "Real research data"), (MODEL, MODEL_E, "Model inference / twin state"),
                                         (SIM, SIM_E, "Model sensitivity (hypothetical)"), (CLIN, CLIN_E, "Clinician interaction"),
                                         (STORE, STORE_E, "Storage / processing")]):
    ax.add_patch(FancyBboxPatch((lx, ly + 18 - i * 3.6), 3, 2.2, boxstyle="round,pad=0.2", fc=fill, ec=edge, lw=1.2))
    ax.text(lx + 4.2, ly + 19.1 - i * 3.6, label, fontsize=8.2, color=INK, va="center")
ax.text(40, 1.2, "Dashed border: offline only, not part of the running app.", fontsize=7.6, color=MUTED)

fig.savefig(OUT / "architecture.pdf", bbox_inches="tight", pad_inches=0.15)
fig.savefig(OUT / "architecture.png", dpi=150, bbox_inches="tight", pad_inches=0.15)
print("wrote", OUT / "architecture.pdf")
