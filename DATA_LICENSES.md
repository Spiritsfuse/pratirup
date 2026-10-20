# Data licences and provenance

The Apache-2.0 licence in `LICENSE` covers this project's **source code only**.
Data keeps the licence its owners gave it.

| Data | Source | Licence | In this repo? | Used for |
|---|---|---|---|---|
| ShanghaiT2DM (100 people with type 2 diabetes, 109 CGM recordings, linked clinical records) | Zhao Q, Zhu J, Shen X, et al. *Chinese diabetes datasets for data-driven machine learning.* Scientific Data 10, 35 (2023). doi:10.1038/s41597-023-01940-7. Files: figshare 21600933 v5 | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | Processed tables in `data/processed/` (reformatted; values unchanged). Raw files are downloaded by `python -m pratirup.cli download`. | Training, validation, test, demo |
| CGMacros (45 people: healthy, prediabetes, T2D; CGM + Fitbit + meals) | Das A, Kerr D, Glantz N, et al. *Scientific Data* 12, 1557 (2025). doi:10.13026/3z8q-x658 (PhysioNet) | [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/) | **No.** Downloaded on demand. | External evaluation only. Shipped model weights are trained on ShanghaiT2DM only. |

## Changes made to ShanghaiT2DM

- Readings placed on a 15-minute grid anchored at each recording's first timestamp.
- CGM values outside 39–501 mg/dL dropped (none were found).
- Free-text medication and diet entries parsed into structured events (`pratirup/data/vocab.py`). The original text is kept next to every parsed value.
- HbA1c converted from mmol/mol to % with the IFCC–NGSP master equation.
- The summary column "Hypoglycemia (yes/no)" is kept for display but **excluded from model inputs**, because the dataset does not state whether it was derived from the same CGM recording.

## What the data does not contain

No genetic markers, no exercise, sleep or heart-rate data, and no macronutrient values. The data was recorded in two hospitals in Shanghai between 2019 and 2021 and is not representative of Indian patients.
