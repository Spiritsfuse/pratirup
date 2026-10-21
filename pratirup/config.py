"""Project-wide constants.

Clinical thresholds follow the International Consensus on Time in Range
(Battelino et al., Diabetes Care 2019). They are fixed here, before any model
is evaluated, and must not be tuned against results.
"""

import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA_RAW = ROOT / "data" / "raw"
DATA_PROCESSED = ROOT / "data" / "processed"
MODELS_DIR = ROOT / "models"
RESULTS_DIR = ROOT / "results"
# Writable runtime cache (SQLite). Override on hosts with a read-only app directory.
VAR_DIR = Path(os.environ.get("PRATIRUP_VAR_DIR", ROOT / "var"))

# Sampling grid. ShanghaiT2DM CGM (Abbott FreeStyle Libre H) reports every 15 min.
STEP_MIN = 15
SLOTS_PER_DAY = 24 * 60 // STEP_MIN

# Forecast horizons. 30 and 60 min are primary; 120 min is evaluated because the
# challenge brief uses it as an example, and is reported as exploratory.
HORIZONS_MIN = (30, 60, 120)
PRIMARY_HORIZONS_MIN = (30, 60)

# Consensus glucose thresholds, mg/dL.
HYPO_L2 = 54
HYPO = 70
HYPER = 180
HYPER_L2 = 250

# Event definition: onset within the next 60 min, confirmed by >= 2 consecutive
# readings beyond the threshold (>= 15 min sustained at 15-min sampling).
EVENT_WINDOW_MIN = 60
EVENT_CONSECUTIVE = 2

# Twin abstention rules: no forecast without >= 2 h of recent history or when the
# latest reading is older than 30 min.
LOOKBACK_SLOTS = 12          # 3 h of history used by features
MIN_HISTORY_READINGS = 8     # of the last LOOKBACK_SLOTS slots
MAX_STALENESS_MIN = 30

# Evaluation protocol.
SEED = 20261020
TEST_FRACTION = 0.20
N_FOLDS = 5
PI_COVERAGE = 0.80
FALSE_ALERT_BUDGET_PER_DAY = 2.0
ALERT_REFRACTORY_MIN = 60
BOOTSTRAP_ITERS = 2000

# Plausible sensor range for input validation (Libre reports 40-500 mg/dL).
GLUCOSE_MIN_VALID = 39.0
GLUCOSE_MAX_VALID = 501.0


def horizon_slots(minutes: int) -> int:
    return minutes // STEP_MIN
