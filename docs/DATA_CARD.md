# Data card

## ShanghaiT2DM (training, testing, demo)

| | |
|---|---|
| Source | Zhao Q, Zhu J, Shen X, et al. *Chinese diabetes datasets for data-driven machine learning.* Scientific Data 10, 35 (2023). figshare 21600933 v5 |
| Licence | CC BY 4.0 (processed copy in `data/processed/`, with attribution) |
| People | 100 adults with type 2 diabetes (109 recordings; 8 people have more than one recording, and all of a person's recordings fall in the same split) |
| Setting | Shanghai East Hospital and Shanghai Fourth People's Hospital, 2019–2021 |
| CGM | Abbott FreeStyle Libre H, every 15 min, 3–14 days; 112,462 readings (39.6–468 mg/dL); 99.99% of intervals exactly 15 min |
| Linked clinical record | 33 fields: demographics, BMI, smoking, alcohol, diabetes duration, complications (micro/macro), comorbidities, glucose-lowering and other drugs, FPG, 2-h PPG, fasting and 2-h C-peptide and insulin, HbA1c, glycated albumin, lipids, creatinine, eGFR, uric acid, BUN; labs within ±6 months of CGM |
| Timed events | 3,808 meals (food names and grams), 842 subcutaneous insulin doses, 2,171 oral-agent entries, 554 pump boluses, 1,087 pump basal-rate entries, 9 i.v. insulin entries |

**Glucose distribution:** 2.3% of readings below 70 mg/dL, 18.9% above 180, 3.8% above 250.

### Processing decisions

1. **Grid.** Each recording is placed on a 15-min grid from its first timestamp. Gaps stay empty (no interpolation).
2. **Insulin.** Names are mapped to rapid, short, premixed or basal by rule. Premixed doses are split into fast and basal parts (for example 70/30 gives 30% fast). Every original string is kept.
3. **Oral agents.** Mapped to drug classes: biguanide, AGI, sulfonylurea, glinide, DPP-4 inhibitor, SGLT2 inhibitor, TZD, GLP-1 RA.
4. **Diet.** Total grams per meal, plus "carbohydrate-dense grams": the weight of foods matching a keyword list such as rice, bread, noodles, congee, fruit. This is a heuristic, not a nutrient calculation. 745 meals marked "data not available" keep their timing only.
5. **HbA1c.** Converted from mmol/mol to % with the IFCC–NGSP master equation.
6. **"Hypoglycemia (yes/no)" field excluded from model inputs**, because the dataset does not state whether it was derived from the same CGM recording.

**Split:** fixed seed 20261020, stratified by insulin use. 20 test patients: `2010, 2012, 2013, 2016, 2019, 2023, 2026, 2032, 2037, 2038, 2049, 2058, 2059, 2062, 2070, 2079, 2080, 2081, 2085, 2099`.

## CGMacros (external validation only)

| | |
|---|---|
| Source | Das A, Kerr D, Glantz N, et al. *Scientific Data* 12, 1557 (2025). PhysioNet doi:10.13026/3z8q-x658 |
| Licence | CC BY-NC-SA 4.0. Not included in this repository; downloaded by script (SHA-256 checked) |
| People | 45 (15 healthy, 16 prediabetes, 14 T2D by HbA1c thresholds 5.7% and 6.5%), Santa Barbara, California |
| Used fields | Libre Pro CGM (original 15-min readings recovered from the 1-min interpolated channel), meal timing, Fitbit heart rate and activity energy, age, sex, BMI, HbA1c, fasting glucose and insulin, lipids |
| Not used | Dexcom channel, meal photos, macronutrients (their meaning differs from ShanghaiT2DM's food weights), microbiome |

## What no dataset here contains

- Genetic markers (shown as "not recorded" in the FHIR record).
- Data from Indian patients.
- Sleep or exercise logs for the training cohort.
- Outcomes beyond the CGM recording.
