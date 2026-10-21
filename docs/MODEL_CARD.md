# Model card: Pratirup glucose twin, v2

All metrics here come from [`results/benchmark.json`](../results/benchmark.json). The README tables are generated from that file. The v1 results are kept in [`results/v1/`](../results/v1/).

## Intended use

- **Users.** Diabetes care teams (diabetologists, educators, remote-monitoring coaches) reviewing adults with type 2 diabetes who wear a CGM.
- **Tasks.** Two:
  - Forecast glucose 30 and 60 minutes ahead (120 minutes exploratory), with an 80% prediction interval.
  - Raise one rate-limited alert stream for predicted glucose below 70 or above 250 mg/dL within 60 minutes. "Above 180" is shown as a ranking signal, not an alert.
- **Status.** Research prototype. Not for clinical decisions. No dosing, diet or treatment advice.
- **Out of scope:**
  - type 1 diabetes, pregnancy, children;
  - inpatient insulin protocols;
  - patient-facing alarms;
  - any use without clinician interpretation.

## Model

| Component | Details |
|---|---|
| Glycaemic state | Local-linear-trend Kalman filter: q_level 0.25, q_slope 16, r 1, damping 0.6. Tuned on development patients. |
| Forecaster | One LightGBM regressor per horizon, predicting the glucose change. 88 inputs: CGM history, Kalman state, signal roughness, time of day, meals, insulin on board, oral agents, pump rate, clinical record, personal time-of-day profile. |
| Noise robustness (v2) | Every LightGBM model also trains on noise-augmented copies of the development recordings: independent Gaussian noise, SD 5, 10 or 15 mg/dL per recording. Augmented rows never enter early-stopping or scored folds. |
| Interval | Quantile models at the 10th and 90th percentiles, conformalised on out-of-fold development predictions (CQR). |
| Event risk | LightGBM classifiers for < 70, > 180 and > 250 mg/dL within 60 min, isotonic-calibrated on out-of-fold predictions. |
| Alert policy (v2) | One stream per patient for < 70 and > 250 only. Shared 60-min cooldown, which a predicted low may override. Thresholds were grid-searched on development data to maximise 2 × hypo sensitivity + > 250 sensitivity, subject to ≤ 1 false alert per patient-day. |
| Self-correction | Exponentially weighted mean of this patient's resolved errors, applied at weight 0.5. |
| Explanations | TreeSHAP (LightGBM `pred_contrib`), shown as associations, not causes. |
| Abstention | No forecast with fewer than 8 readings in the last 3 h, or when the last reading is older than 30 min. |

**Hyperparameters.** 31 leaves, ≥ 300 rows per leaf, feature fraction 0.8, bagging 0.8, L2 1.0, learning rate 0.03. The number of rounds was set by early stopping on held-out development patients.

**Compared but not served:**

- a tuned GRU sequence network;
- an average of LightGBM and GRU;
- Amazon Chronos-Bolt (small), used zero-shot.

On test patients the GRU is about 0.19 mg/dL better at 60 min. That difference is detectable but clinically negligible. LightGBM is served for its exact attributions, conformal intervals and CPU-only runtime. Chronos-Bolt zero-shot is much worse: 18.7 mg/dL at 60 min.

## Data

| | |
|---|---|
| Training and testing | ShanghaiT2DM: 100 adults with T2D from 2 Shanghai hospitals, 2019–2021. Split by patient: 80 development (5 folds), 20 test. |
| Test policy | The test set is scored behind a lock. v1 was scored once. v2 was scored once more, with the reason logged in `results/runs.jsonl`. Every v2 choice was made on development data. |
| External test | CGMacros: 45 US adults (healthy, prediabetes, T2D), Libre Pro, free-living. Never used for training. |

## Performance on held-out patients (v2)

**Forecast accuracy (MAE)**

| Horizon | Pratirup | Last value carried forward | Difference (95% CI) |
|---|---|---|---|
| 30 min | 8.84 mg/dL | 12.08 | |
| 60 min | 14.90 mg/dL | 20.07 | −5.17 (−6.30 to −4.12) |
| 120 min | 20.49 mg/dL | 30.18 | |

- **Per patient, 60 min:** MAE 16.0 ± 3.7 mg/dL (mean ± SD over 20 patients).
- **Clinical safety:** Parkes type-2 error grid zones A+B ≥ 99.4% at every horizon.
- **Interval coverage (nominal 80%):** 81% / 81% / 83% at 30 / 60 / 120 min.

**Under sensor noise (30-min MAE)**

| Noise | v2 | v1 | Last value |
|---|---|---|---|
| Independent, SD 10 | 13.5 | 19.6 | 15.1 |
| Autocorrelated (AR(1)), SD 10 | 12.9 | — | 15.2 |

**Alert policy**

- 1.89 alerts per patient-day, of which 1.38 are false (v1: about 7.9).
- < 70 mg/dL: 82.9% of 76 episodes caught; 56.6% caught ≥ 30 min ahead.
- > 250 mg/dL: 77.8% of 54 episodes caught.

**External (CGMacros, T2D)**

- 60-min MAE 17.2 vs 22.4 for last value; interval coverage 78%.
- Alert policy: 1.78 alerts per patient-day; 88% of hypo episodes caught.

## Known limitations and failure modes

- **Alert budget overshoot.** The policy's false-alert rate on test (1.38 per day) is above the development budget (1.0). Per-event sensitivity is lower than for classifiers tuned alone. That is the price of a usable alert load.
- **Heavy noise.** Under heavy independent noise (SD 20), the 30-min forecast only matches last value carried forward.
- **Sharp peaks.** Forecasts under-predict the height of sharp post-meal peaks, because the model predicts a conditional mean.
- **Healthy people.** In CGMacros healthy participants, the gain over last value is close to zero.
- **Population.** Trained on a Chinese hospital cohort. Transfer to Indian diets, drug mix and care settings is untested.

## Ethical and regulatory considerations

- **Clinical benefit** is unproven.
- **Medical-device rules.** A deployed version would need classification as software as a medical device under CDSCO's Medical Devices Rules 2017.
- **Data protection.** It would need DPDP Act 2023 compliance for real patient data.
