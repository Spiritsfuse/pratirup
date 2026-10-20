# Pratirup

**A glucose digital twin for type 2 diabetes care teams.**
Pratirup (प्रतिरूप, "counterpart") keeps a continuously updated model of each person with type 2 diabetes. It combines their clinical record with their CGM stream and logged medication and meals. It forecasts glucose 30–60 minutes ahead, warns of imminent excursions with measured uncertainty, and keeps an auditable record of how well every forecast matched reality.

> **Research prototype. Not a medical device.** Outputs are experimental. They were evaluated retrospectively on open research data and must be interpreted by a qualified clinician. Pratirup does not diagnose, prescribe or recommend treatment changes.

---

## Team and submission

| | |
|---|---|
| Team | **Aflatoon** (Unstop team ID: `pratyushm704`) |
| College | Scaler School of Technology, Bengaluru |
| Members | Dhruv Sharma ([@Spiritsfuse](https://github.com/Spiritsfuse)) · Pratyush Mishra ([@PratyushMishra-2nd](https://github.com/PratyushMishra-2nd)) · Anushika Chauhan ([@Anushika06](https://github.com/Anushika06)) |
| Challenge | Happiest Health Digital Twin Challenge 2026 |
| Submission folder name | `Aflatoon_Scaler School of Technology` |
| Project title | Pratirup: a glucose digital twin for type 2 diabetes care teams |

| Required artefact | Where |
|---|---|
| Demonstration video (≥ 20 min) | _Unlisted YouTube link: to be added by the team before submission_ |
| Architecture diagram (PDF) | [`docs/architecture.pdf`](docs/architecture.pdf) |
| Presentation (PDF / PPTX) | [`docs/Pratirup_Presentation.pdf`](docs/Pratirup_Presentation.pdf) · [`docs/Pratirup_Presentation.pptx`](docs/Pratirup_Presentation.pptx) |
| Open-source licence | [Apache-2.0](LICENSE) for code; data keeps its own licences ([`DATA_LICENSES.md`](DATA_LICENSES.md)) |
| Model and data cards | [`docs/MODEL_CARD.md`](docs/MODEL_CARD.md) · [`docs/DATA_CARD.md`](docs/DATA_CARD.md) |

---

## Problem statement

**In one sentence.** Clinicians reviewing CGM data for people with type 2 diabetes see where glucose *has been*, separately from the patient's clinical record. Pratirup keeps a continuously updated model of each patient that combines both. It forecasts the next 30–60 minutes, warns of imminent excursions with measured uncertainty, and scores itself against what actually happens.

**Why it matters.** ICMR-INDIAB-17 estimates that 101 million people in India have diabetes, and a further 136 million have prediabetes ([Anjana et al., Lancet Diabetes Endocrinol 2023](https://www.thelancet.com/journals/landia/article/PIIS2213-8587(23)00119-5/fulltext)). Among people with diagnosed diabetes, only 36.3% reach HbA1c < 7% ([ICMR-INDIAB-13, 2022](https://www.thelancet.com/journals/landia/article/PIIS2213-8587(22)00072-9/abstract)). The international consensus sets CGM targets of < 25% of time above 180 mg/dL and < 4% below 70 mg/dL ([Battelino et al., Diabetes Care 2019](https://pmc.ncbi.nlm.nih.gov/articles/PMC6973648/)). The ADA 2026 Standards recommend CGM for people with T2D on insulin, and for T2D on other glucose-lowering drugs where CGM helps management (Rec. 7.15).

**What is missing.** Clinician CGM tools such as LibreView, Dexcom Clarity and Glooko are retrospective: a report reviewed at a visit. Forward-looking alerts already exist, but they are patient-facing, use CGM only (plus any logged carbs and insulin) and are tied to one vendor's device:

- Dexcom G7 "Urgent Low Soon" looks 20 min ahead.
- Medtronic alerts look up to 60 min ahead.
- Roche Accu-Chek SmartGuide predicts lows 30 min ahead and gives a 2-hour trajectory.

**Forecasting itself is not new, and we do not claim it is.** What we did not find is a clinician-facing view that does all of the following:
- uses the clinical record,
- ranks a panel of patients by imminent risk,
- explains each forecast,
- publishes a running, per-patient score of its own forecasts.

**Healthcare use case.** A diabetes care team (diabetologist, educator or remote-monitoring coach) runs a 14-day connected or professional CGM programme for adults with T2D.
- **During wear:** the twin updates on every reading. The worklist surfaces patients who are low now, predicted to go low, or predicted to rise above 180 or 250 mg/dL within the hour.
- **At the follow-up visit:** the clinician replays any moment to see what the twin expected and what actually happened.
- **Decisions:** clinicians make every decision. Whether this improves outcomes is a hypothesis that needs a prospective study.

**Outputs**
- **Primary:** glucose at +30 and +60 min, with a conformal 80% prediction interval. +120 min is reported as exploratory.
- **Secondary:** calibrated probability that glucose crosses 180 mg/dL, crosses 250 mg/dL, or falls below 70 mg/dL within 60 min, each confirmed by ≥ 2 consecutive readings (≥ 15 min). The thresholds come from the consensus above and were fixed before any model was trained.

---

## What makes this a digital twin (and not a dashboard with a model)

Each patient has a **persistent state** that is updated on **every reading and logged event**.

| State block | Contents | Observed or estimated |
|---|---|---|
| Clinical context | age, sex, BMI, diabetes duration, HbA1c, C-peptide, lipids, eGFR, complications, drug classes (FHIR R4 record) | observed |
| Glycaemic state | glucose level, rate of change and their uncertainty (local-linear-trend **Kalman filter**; uncertainty grows during sensor gaps) | estimated |
| Event context | time since meals and fast-acting insulin, insulin on board, oral agents (sulfonylurea / glinide, AGI, metformin), pump basal rate | observed |
| Personal profile | time in/above/below range so far; what this person's glucose usually does at this time of day, from their own previous days | estimated |
| Model trust | running mean of this patient's own resolved forecast errors (the forecast ledger) | estimated |
| Data quality | readings in the last 3 h, age of last reading → **abstains** instead of guessing | observed |

**Update loop** (`pratirup/twin/engine.py`), on each new reading:
1. Validate the reading.
2. Run the Kalman update.
3. **Resolve** past forecasts whose target time has arrived, and update model trust.
4. Rebuild features from data at or before now only.
5. Forecast with intervals.
6. Compute event risk.
7. Write the forecast to the ledger.
8. Refresh the worklist.

The streaming implementation (`LiveTwin`) and the vectorised replay that the benchmark scores share every formula. [`tests/test_twin_parity.py`](tests/test_twin_parity.py) requires them to give identical outputs, reading by reading.

**What-if.** The "What-if" tab changes one logged input (adds or removes a meal or a fast-insulin dose) and reruns the *same* feature builder and model. It is labelled **model sensitivity: associational, not causal**. Observational data cannot identify the causal effect of eating or dosing, so we do not claim a physiological simulator.

**What the twin cannot represent:** insulin sensitivity or carbohydrate absorption as mechanisms, exercise, sleep, stress, unlogged meals, or anything beyond about 2 hours.

---

## Data

| Role | Dataset | Why |
|---|---|---|
| Train / validate / test, and the demo | **ShanghaiT2DM** (Zhao et al., [Scientific Data 2023](https://pmc.ncbi.nlm.nih.gov/articles/PMC9849330/)): 100 people with T2D, 109 recordings of 3–14 days, Abbott Libre H CGM every 15 min, CC BY 4.0 | The clinical record and the CGM, insulin, oral-drug and diet logs belong to **the same patients**, linked by ID. The "fusion of two streams" is real, not a join of unrelated people. |
| External validation only | **CGMacros** (Das et al., Scientific Data 2025, [PhysioNet](https://physionet.org/content/cgmacros/1.0.0/)): 45 US adults (healthy / prediabetes / T2D), Libre Pro, Fitbit heart rate and activity, CC BY-NC-SA 4.0 | Different country, device and setting (free-living vs hospital). Tests whether the frozen model transfers, and whether wearables add value. |

**Rejected options:**
- **UCI Diabetes #34:** 70 people with type 1 diabetes, finger-prick readings rather than CGM, from around 1991.
- **Synthea + an unrelated CGM dataset:** the records and the CGM would belong to different people.
- **AI-READI:** no redistribution right.
- **Fully synthetic physiology:** the model would only learn our own assumptions.

No open Indian CGM dataset exists. This is the main external-validity gap.

**Genetic markers** appear in the brief's EHR example, but no dataset contains them. The record shows them as *not recorded* (FHIR `dataAbsentReason`) instead of inventing values. Details and parsing decisions: [`docs/DATA_CARD.md`](docs/DATA_CARD.md), [`DATA_LICENSES.md`](DATA_LICENSES.md).

---

## Models and evaluation protocol

**Compared models**
- Last value carried forward (persistence)
- Kalman damped trend
- Ridge autoregression
- **GRU sequence network**, tuned on development data
- A LightGBM ablation ladder: CGM → + logs → + clinical record → + personal history (= Pratirup)
- Pratirup + online self-correction
- An average of LightGBM and GRU

**Served model:** Pratirup (LightGBM). It ties the tuned GRU, and gives exact per-feature attributions (TreeSHAP) for "why this forecast", conformal intervals and fast CPU inference without a deep-learning runtime.

**Protocol (fixed before testing)**
- Patient-level split: 80 development patients (5 folds, stratified by insulin use) and 20 test patients.
- Every choice was made with patient-grouped cross-validation on development patients only: Kalman parameters, hyperparameters, GRU configuration, conformal adjustment, personalisation, isotonic calibration, and alert thresholds (≤ 2 false alerts per patient-day).
- Early stopping used held-out *development* patients, never the fold being scored.
- **The test set was scored once**, behind a lock file.
- [`tests/test_leakage.py`](tests/test_leakage.py) recomputes every feature on series truncated at the forecast time and requires identical values.

**Metrics**
- Forecasts: MAE, RMSE, bias, MARD, MAE by glucose band, and the Parkes (Consensus) Error Grid for type 2 diabetes.
- Intervals: empirical coverage and width.
- Alerts, counted per episode: sensitivity, sensitivity with ≥ 30 min warning, PPV, false alerts per patient-day, lead time, AUPRC against prevalence, and calibration.
- Robustness and subgroups.
- All comparisons carry patient-level bootstrap 95% CIs.

## Results

<!-- RESULTS:START -->
All numbers below are generated from [`results/benchmark.json`](results/benchmark.json) by `scripts/update_readme_results.py`.
Test set: 20 held-out patients, scored once on 2026-10-21T00:47:48 (see [`results/TEST_LOCK.json`](results/TEST_LOCK.json)).
Confidence intervals come from a patient-level bootstrap.

#### Forecast accuracy (held-out patients, mg/dL)

| Model | MAE 30 min | MAE 60 min | MAE 120 min* | RMSE 60 min | Parkes A+B 60 min |
|---|---|---|---|---|---|
| Last value carried forward | 12.08 | 20.07 | 30.18 | 29.97 | 99.6% |
| Kalman damped trend | 10.84 | 19.46 | 30.84 | 29.22 | 99.7% |
| Linear autoregression (ridge) | 9.81 | 17.82 | 26.80 | 25.68 | 99.9% |
| GRU sequence network | 8.65 | 14.71 | 20.15 | 21.98 | 100.0% |
| LightGBM: CGM only | 9.11 | 16.09 | 22.86 | 23.34 | 99.9% |
| LightGBM: CGM + logs | 8.99 | 15.73 | 22.54 | 23.01 | 99.9% |
| LightGBM: CGM + logs + clinical record | 8.96 | 15.79 | 22.64 | 23.02 | 100.0% |
| **Pratirup: + personal history** | 8.64 | 14.76 | 20.33 | 21.64 | 100.0% |
| Pratirup + online self-correction | 8.64 | 14.74 | 20.29 | 21.66 | 100.0% |
| Average of LightGBM and GRU (not deployed) | 8.56 | 14.57 | 19.96 | 21.60 | 100.0% |

\* 120 min is exploratory; the brief's "2 hours in advance" example was evaluated directly rather than assumed.

- **30 min:** -3.44 mg/dL vs last value carried forward (95% CI -4.10 to -2.81).
- **60 min:** -5.32 mg/dL vs last value carried forward (95% CI -6.46 to -4.24).
- **120 min:** -9.84 mg/dL vs last value carried forward (95% CI -11.85 to -8.13).
- Versus the GRU at 60 min: 0.04 mg/dL (95% CI -0.14 to 0.20), i.e. no measurable difference.
- Adding logs, clinical record and personal history to CGM-only LightGBM at 60 min: -1.34 mg/dL (95% CI -1.75 to -0.90).
- Online self-correction at 60 min: -0.02 mg/dL (95% CI -0.11 to 0.07), i.e. no measurable gain.

#### Uncertainty

| Horizon | Empirical coverage (nominal 80%) | Mean width (mg/dL) |
|---|---|---|
| 30 min | 81.3% | 27.3 |
| 60 min | 80.9% | 45.6 |
| 120 min | 83.5% | 67.2 |

#### Early warning (event level, 60-min refractory, thresholds fixed on development patients)

| Event | Scorer | Episodes | Sensitivity | ≥30 min warning | PPV | False alerts / patient-day | AUPRC (prevalence) |
|---|---|---|---|---|---|---|---|
| Rise above 180 mg/dL within 60 min | Pratirup calibrated classifier | 288 | 95.5% | 64.9% | 46.9% | 1.51 | 0.549 (0.049) |
|  | Rate-of-change extrapolation | 288 | 89.2% | 47.6% | 40.8% | 1.81 | 0.398 (0.049) |
| Rise above 250 mg/dL within 60 min | Pratirup calibrated classifier | 54 | 98.1% | 81.5% | 15.6% | 1.39 | 0.549 (0.008) |
|  | Rate-of-change extrapolation | 54 | 98.1% | 77.8% | 12.6% | 1.79 | 0.322 (0.008) |
| Fall below 70 mg/dL within 60 min | Pratirup calibrated classifier | 76 | 94.7% | 64.5% | 10.2% | 3.08 | 0.340 (0.011) |
|  | Rate-of-change extrapolation | 76 | 73.7% | 46.1% | 9.5% | 2.58 | 0.124 (0.011) |

Total alert load across the three alert types: 7.9 alerts per patient-day. This is too many for routine use (see Limitations).

#### Robustness (inputs perturbed, true future readings unchanged)

| Perturbation | No forecast issued (missing reading or < 8 readings in 3 h) | MAE 30 min (Pratirup / last value) | MAE 60 min (Pratirup / last value) | Coverage 60 min |
|---|---|---|---|---|
| 10% of readings missing | 10.3% | 9.3 / 12.1 | 15.2 / 20.1 | 82.2% |
| 30% of readings missing | 44.2% | 10.3 / 12.1 | 15.9 / 20.0 | 84.8% |
| 1-h gap every day | 4.2% | 8.8 / 12.1 | 14.9 / 20.1 | 81.0% |
| ±10 mg/dL random noise | 0.0% | 19.6 / 15.2 | 21.2 / 22.4 | 73.5% |
| ±20 mg/dL random noise | 0.0% | 29.4 / 20.8 | 28.4 / 26.9 | 65.7% |

#### External validation: CGMacros (frozen model, different country, device and setting)

| Group (CGMacros) | People | MAE 60 min: Pratirup | GRU | Last value | Interval coverage |
|---|---|---|---|---|---|
| t2d | 14 | 16.90 | 16.75 | 22.37 | 78.3% |
| prediabetes | 16 | 14.15 | 13.96 | 16.96 | 80.9% |
| healthy | 15 | 12.34 | 11.77 | 12.47 | 80.2% |
| all | 45 | 14.43 | 14.12 | 17.19 | 79.8% |

Rise-above-180 alerts in the 14 CGMacros participants with T2D: sensitivity 96.7%, PPV 53.1%, 1.38 false alerts per patient-day.

Wearable experiment (inside CGMacros, 5-fold participant-grouped CV): adding Fitbit heart rate and activity energy changed 60-min MAE by -0.02 mg/dL (95% CI -0.09 to 0.04): no measurable benefit.
<!-- RESULTS:END -->

### What the evidence does and does not support

- **Supported:** on unseen patients from a Chinese hospital T2D cohort, Pratirup forecasts 30–120 min glucose more accurately than standard baselines, and its 80% intervals are well calibrated. The gain and the calibration carry over to a US free-living cohort with a different sensor.
- **What helped:** the patient's own history (time-of-day profile) gave the largest gain.
- **What did not help measurably:**
  - clinical-record fields beyond CGM and logs,
  - online residual self-correction,
  - Fitbit heart rate and activity.

  We report these rather than hide them.
- **Not supported:** validation in Indian patients; prospective or real-time clinical use; any causal effect of meals or drugs; any improvement in outcomes.

---

## The application

| Screen | What it shows |
|---|---|
| Worklist | The 20 held-out patients on a shared demo clock, ranked by consensus targets and predicted risk; current glucose, trend, 60-min forecast, risks against thresholds, 24-h AGP-style range bar |
| Patient twin | CGM with the forecast band, **past forecasts drawn against what actually happened**, logged events, twin state, risk, and the drivers of the forecast (with source: CGM / logs / clinical record / personal history) |
| Ledger | Every forecast for this patient, scored at its target time: MAE against last value, interval coverage by day |
| What-if | Model sensitivity to a changed meal or insulin log, with out-of-range warnings and a causal disclaimer |
| Record | The clinical record and its raw FHIR R4 bundle |
| Live stream | A held-out recording streamed one reading at a time into a live twin, as a CGM device would send it |
| Evidence | Every metric, read from `results/benchmark.json` |

**Provenance labels everywhere:** research record, replayed CGM, model forecast, sensitivity (not causal), live stream. Calendar dates are hidden; wear day and clock time are real.

---

## Run it

**Docker** (recommended; no Python or Node needed, works offline):

```bash
docker build -t pratirup .
docker run --rm -p 8000:8000 pratirup
# open http://localhost:8000
```

**Local:**

```bash
python -m venv .venv && . .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements-serve.txt
cd web && npm ci && npm run build && cd ..
python -m pratirup.cli serve                           # http://127.0.0.1:8000
```

The first start builds `var/pratirup.sqlite3` from the committed processed data and models (a few seconds). **Live demo:** open *Live stream*, pick a patient and press Start. Or stream from outside, like a device would:

```bash
python scripts/device_stream.py --recording 2026_0_20210916 --seconds-per-reading 1
```

## Reproduce every number

```bash
pip install -r requirements.txt --extra-index-url https://download.pytorch.org/whl/cpu
python -m pratirup.cli download            # ShanghaiT2DM from figshare (sha256 checked)
python -m pratirup.cli prepare             # processed tables; keeps the committed split
python -m pratirup.cli benchmark-dev       # all tuning on development patients (~12 min on a laptop CPU)
python -m pratirup.cli benchmark-test --reason "reproduction"   # test is locked; a reason is logged
python -m pratirup.cli download --cgmacros # 657 MB from PhysioNet's open-data mirror (sha256 checked)
python -m pratirup.cli external
python -m pratirup.cli report && python scripts/update_readme_results.py
pytest                                     # leakage, label, and live-vs-replay parity tests
```

- **Seeds:** fixed (`20261020`).
- **Package versions:** pinned in `requirements.txt`.
- **No GPU** is needed.
- **No external API, account or secret** is used anywhere.

## Technical stack

| Layer | Choice | Why |
|---|---|---|
| Models | LightGBM 4.7 (point, quantile, binary), scikit-learn (isotonic, ridge), PyTorch 2.14 (GRU comparison only) | Small tabular-temporal data; exact attributions; CPU-only |
| Uncertainty | Conformalised quantile regression (CQR) | Coverage guarantee under exchangeability; checked on unseen patients |
| Twin state | Kalman filter (NumPy), exponentially weighted residual memory | Explicit, inspectable state with uncertainty |
| Interoperability | FHIR R4 resources (Patient, Condition, Observation, MedicationStatement) | Same model of record as India's ABDM (NRCeS FHIR IG) |
| Backend | Python 3.12, FastAPI, SQLite | One process, one file, zero setup |
| Frontend | React 18, TypeScript, Vite, Tailwind CSS, Recharts | Typed and fast; charts with explicit units |
| Packaging | Docker multi-stage image, non-root, offline | Runs on any machine |

## Repository layout

```
pratirup/data/         ingestion, drug/diet normalisation, FHIR, patient split
pratirup/features.py   causal feature builder (shared by training, evaluation and the live twin)
pratirup/twin/         Kalman state, twin engine (replay and streaming), labels
pratirup/models/       LightGBM helpers, model bundle, GRU
pratirup/evaluation/   metrics (incl. Parkes type 2), benchmark protocol, external validation, report
pratirup/api/          SQLite store and FastAPI app
web/                   React clinician app
models/                trained bundle (LightGBM text files + JSON manifest) and ablation models
results/               dev CV, locked test results, external results, figures
docs/                  architecture diagram, presentation, model and data cards, video script
tests/                 leakage, labels, live-vs-replay parity
```

## Limitations

- **Population.** Chinese hospital cohort, 2019–2021, partly in-hospital with regular meal times, which likely helps the time-of-day profile. Not Indian, not representative. External validation covers a US cohort, not an Indian one.
- **Size.** 100 patients, 3–14 days each; 20 test patients. CIs are reported for this reason.
- **Alert load.** Thresholds were set per alert type on development data. On test patients, total alerts reach about 8 per patient-day, and the low-glucose alert exceeded its false-alert budget. A deployable version needs alerts merged into one stream with a shared cooldown, and budgets set with clinicians.
- **Sensor noise.** Libre output is already smoothed. When independent ±10 mg/dL noise is added to every reading, the 30-min forecast becomes worse than last value carried forward. A noisier device would need noise-augmented training.
- **Causality.** The what-if is model sensitivity, not an intervention effect.
- **Data gaps.** No genetic, exercise or sleep data in the training cohort; diet is food weight (a carbohydrate-dense-weight heuristic), not nutrients.
- **Retrospective only.** No prospective, real-time or clinical-outcome evaluation.

## Clinical, privacy and regulatory notes

- **Data used.** Only open, de-identified research data. No personal data is collected or processed, and no secrets exist in this repository.
- **Medical-device regulation.** A deployed version that generates patient-specific alerts would likely be software as a medical device under India's Medical Devices Rules 2017 (see CDSCO's draft guidance on medical device software, 21 Oct 2025). In the US, under FDA's 2026 clinical decision support guidance, time-critical alerting is generally a device function.
- **Data protection.** Real patient data would fall under India's DPDP Act 2023 and DPDP Rules 2025 (consent, notice, security and breach duties).
- **Clinical evidence.** Clinical benefit has not been shown. A prospective study in Indian care settings would be required.

## Licence

Code: [Apache-2.0](LICENSE). Data: ShanghaiT2DM CC BY 4.0 (processed copy included, with attribution); CGMacros CC BY-NC-SA 4.0 (not included; downloaded on demand). The shipped models are trained on ShanghaiT2DM only. See [`DATA_LICENSES.md`](DATA_LICENSES.md).

## Citations

- Zhao Q, et al. Chinese diabetes datasets for data-driven machine learning. *Scientific Data* 10, 35 (2023).
- Das A, et al. CGMacros: a scientific dataset for personalized nutrition and diet monitoring. *Scientific Data* 12, 1557 (2025). PhysioNet doi:10.13026/3z8q-x658.
- Battelino T, et al. Clinical targets for CGM data interpretation: International Consensus on Time in Range. *Diabetes Care* 42(8):1593 (2019).
- Parkes JL, et al. A new consensus error grid. *Diabetes Care* 23(8):1143 (2000); Pfützner A, et al. *J Diabetes Sci Technol* 7(5):1275 (2013).
- Romano Y, Patterson E, Candès E. Conformalized quantile regression. *NeurIPS* (2019).
- Sergazinov R, et al. GlucoBench. *ICLR* (2024).
- Anjana RM, et al. ICMR-INDIAB-17. *Lancet Diabetes Endocrinol* 11(7):474 (2023).
