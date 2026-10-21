"""The streaming twin must reproduce the batch replay exactly.

LiveTwin receives one recording event by event and reading by reading. Its
forecasts, intervals, personal corrections, risks and alerts must match
replay_outputs(), which is the code path the benchmark scores.
"""

import json

import numpy as np
import pandas as pd
import pytest

from pratirup.config import DATA_PROCESSED, MODELS_DIR, STEP_MIN
from pratirup.features import STATIC_FEATURES, series_by_recording
from pratirup.models.bundle import EVENT_KINDS, ModelBundle
from pratirup.twin.engine import LiveTwin, replay_outputs

pytestmark = pytest.mark.skipif(not (MODELS_DIR / "bundle.json").exists(), reason="model bundle not trained")
N_SLOTS = 500


@pytest.fixture(scope="module")
def setup(tables):
    split = json.loads((DATA_PROCESSED / "split.json").read_text())
    recs = tables["recordings"]
    rec = recs[recs["patient_id"] == split["test_patients"][0]].iloc[0]
    s = series_by_recording(rec.to_frame().T, tables["cgm"], tables["events"])[rec["recording_id"]]
    return rec, s, ModelBundle.load(MODELS_DIR), tables


def test_live_equals_replay(setup):
    rec, s, bundle, tables = setup
    batch = replay_outputs(s.truncate(N_SLOTS - 1), bundle)
    live = LiveTwin(rec["recording_id"], rec["patient_id"], s.t0, {k: rec.get(k) for k in STATIC_FEATURES}, bundle)
    ev = tables["events"]
    ev = ev[(ev["recording_id"] == rec["recording_id"]) & (ev["slot"] < N_SLOTS)].sort_values("slot")
    by_slot = {k: g for k, g in ev.groupby("slot")}
    got_fc, got_state = [], {}
    for slot in range(N_SLOTS):
        ts = s.t0 + pd.Timedelta(minutes=slot * STEP_MIN)
        for e in by_slot.get(slot, pd.DataFrame()).itertuples():
            kw = {k: getattr(e, k) for k in ("grams", "carb_grams", "fast_units", "basal_units", "rate",
                                            "secretagogue", "agi", "biguanide") if pd.notna(getattr(e, k))}
            live.ingest_event(ts, e.kind, **kw)
        if np.isfinite(s.glucose[slot]):
            upd = live.ingest_reading(ts, float(s.glucose[slot]))
            got_fc.extend(upd.forecasts)
            got_state[slot] = upd.state
    live_fc = pd.DataFrame(got_fc).set_index(["issue_slot", "horizon"]).sort_index()
    bf = batch.forecasts.set_index(["issue_slot", "horizon"]).sort_index()
    assert len(live_fc) == len(bf) > 0
    for c in ("yhat_pop", "yhat", "lo", "hi"):
        np.testing.assert_allclose(live_fc[c].to_numpy(), bf.loc[live_fc.index, c].to_numpy(), rtol=1e-7, atol=1e-6)
    st = batch.state.set_index("slot")
    for slot, state in got_state.items():
        if not state.get("issuable"):
            continue
        for kind in EVENT_KINDS:
            a, b = state[f"p_{kind}"], st.loc[slot, f"p_{kind}"]
            assert (np.isnan(a) and np.isnan(b)) or abs(a - b) < 1e-9
            assert bool(state[f"alert_{kind}"]) == bool(st.loc[slot, f"alert_{kind}"])
        assert state.get("alert") == (st.loc[slot, "alert"] if isinstance(st.loc[slot, "alert"], str) else None)
