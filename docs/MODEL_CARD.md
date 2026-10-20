# Model card: Pratirup glucose twin v0.1

All metrics referenced here are in [`results/benchmark.json`](../results/benchmark.json); the README tables are generated from it.

## Intended use

- **Users:** diabetes care teams (diabetologists, diabetes educators, remote-monitoring coaches) reviewing adults with type 2 diabetes who wear a CGM.
- **Task:** forecast glucose 30 and 60 minutes ahead (120 min exploratory) with an 80% prediction interval. Estimate the probability that glucose rises above 180 or 250 mg/dL, or falls below 70 mg/dL, within 60 minutes.
- **Status:** research prototype for a student challenge. It is not for clinical decisions, and it gives no dosing, diet or treatment recommendations.

**Out of scope:**
- type 1 diabetes, pregnancy, children, hospital insulin infusion protocols;
- patient-facing alarms;
- any use without clinician interpretation.

## Model

| Component | Details |
|---|---|
| Glycaemic state | Local-linear-trend Kalman filter (q_level 0.25, q_slope 16, r 1, damping 0.6; tuned on development patients) |
| Forecaster | LightGBM regressor of the glucose change, one per horizon; 87 inputs (CGM history, Kalman state, time of day, meals, insulin on board, oral agents, pump rate, clinical record, personal profile) |
| Interval | LightGBM quantile models (10th and 90th percentiles), conformalised on out-of-fold development predictions (CQR) |
| Event risk | LightGBM classifiers for each event, isotonic-calibrated on out-of-fold predictions; alert threshold set on development patients for ≤ 2 false alerts per patient-day; 60-min refractory |
| Self-correction | Exponentially weighted mean of this patient's resolved errors, applied at weight 0.5 (half-life 48–96 forecasts) |
| Explanations | TreeSHAP contributions (LightGBM `pred_contrib`), shown as associations |
| Abstention | No forecast if fewer than 8 readings in the last 3 h, or if the last reading is older than 30 min |

**Hyperparameters:** 31 leaves, ≥ 300 rows per leaf, feature fraction 0.8, bagging 0.8, L2 1.0, learning rate 0.03. Rounds were chosen by early stopping on held-out development patients. An 8-configuration search changed cross-validated MAE by less than 0.1 mg/dL.

**Not deployed, reported for comparison:** a GRU sequence network and a LightGBM + GRU average. The GRU ties LightGBM on test patients (60 min difference +0.04 mg/dL, 95% CI −0.14 to +0.20). LightGBM is served because it gives exact per-feature attributions, conformal intervals and CPU inference without a deep-learning runtime.

## Training and evaluation data

| | |
|---|---|
| Source | ShanghaiT2DM, 100 adults with type 2 diabetes from 2 Shanghai hospitals, 2019–2021 |
| Split | 80 development patients (5 folds, stratified by insulin use) and 20 test patients |
| Test policy | Scored once after every choice was frozen ([`results/TEST_LOCK.json`](../results/TEST_LOCK.json)) |
| External test | CGMacros: 45 US adults (healthy / prediabetes / T2D), different Libre model, free-living |

## Performance (held-out patients)

**60-min forecast**
- MAE 14.76 mg/dL, against 20.07 for last value carried forward.
- Difference −5.32 mg/dL, 95% CI −6.46 to −4.24.
- Parkes type-2 grid zones A+B: 100.0%.
- 80% interval coverage: 80.9%.

**Rise above 180 mg/dL within 60 min**
- 95.5% of 288 episodes detected; 64.9% with at least 30 min of warning.
- PPV 46.9%; 1.51 false alerts per patient-day.

**Fall below 70 mg/dL within 60 min**
- 94.7% of 76 episodes detected.
- PPV 10.2%; 3.08 false alerts per patient-day, above the development budget.

**External (CGMacros, T2D)**
- 60-min MAE 16.9 mg/dL, against 22.4 for last value carried forward.
- Interval coverage 78.3%.

**By subgroup** (`subgroups_test`)
- Error is higher in insulin-treated patients and in those with HbA1c ≥ 8%.
- The gain over last value carried forward holds in every subgroup.

## Known failure modes

- **Sensor noise:** independent noise on each reading (±10 mg/dL) makes the 30-min forecast worse than last value carried forward. The model relies on reading-to-reading change.
- **Alert load:** across three alert types, about 8 alerts per patient-day on test patients.
- **Rare low readings:** lows are rare (1.1% prevalence), so alert precision is low.
- **Peaks:** forecasts tend to under-predict the height of sharp post-meal peaks (the forecast is a conditional mean).
- **Healthy people:** in CGMacros, the gain over last value carried forward is close to zero for healthy participants (the model is not intended for them).

## Ethical and regulatory considerations

- Trained on Chinese hospital data; it may not transfer to Indian diets, drug mix or care settings without local validation.
- Clinical benefit is unproven.
- A deployed version would need regulatory classification as software as a medical device (CDSCO, Medical Devices Rules 2017).
- A deployed version would need DPDP Act 2023 compliance for any real patient data.
