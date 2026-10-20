"""No feature may depend on data after the forecast time.

For several recordings and cut points s, features computed on the series
truncated at s must equal the features at s computed on the full series.
"""

import numpy as np
import pytest

from pratirup.features import build_features, build_targets, series_by_recording
from pratirup.twin.kalman import KalmanParams

KP = KalmanParams()


@pytest.fixture(scope="module")
def series(tables):
    recs = tables["recordings"]
    # Include insulin-pump, multiple-daily-injection and oral-only recordings.
    pick = recs.sort_values("recording_id").iloc[[0, 7, 23, 41, 66, 90, 108]]
    return series_by_recording(pick, tables["cgm"], tables["events"])


def test_features_are_causal(series):
    rng = np.random.default_rng(0)
    for s in series.values():
        full = build_features(s, KP)
        cols = [c for c in full.columns if c not in ("recording_id", "patient_id", "ts")]
        for cut in sorted(rng.choice(np.arange(20, s.n - 1), size=6, replace=False)):
            part = build_features(s.truncate(int(cut)), KP)
            a = full.loc[cut, cols].to_numpy(dtype=float)
            b = part.loc[cut, cols].to_numpy(dtype=float)
            assert np.allclose(a, b, equal_nan=True, rtol=1e-9, atol=1e-9), (
                f"{s.recording_id} slot {cut}: "
                + str([c for c, x, y in zip(cols, a, b) if not np.isclose(x, y, equal_nan=True)])
            )


def test_targets_use_future_only_for_labels(series):
    s = next(iter(series.values()))
    t = build_targets(s)
    g = s.glucose
    i = int(np.flatnonzero(np.isfinite(g))[30])
    if np.isfinite(g[i + 4]):
        assert t.loc[i, "y_60"] == g[i + 4]
        assert t.loc[i, "dy_60"] == g[i + 4] - g[i]


def test_hyper_label_definition():
    from pratirup.features import Series

    g = np.array([150, 160, 170, 185, 190, 175, 170, 160, 150, 140, 130, 120], dtype=float)
    z = np.zeros_like(g)
    s = Series("r", "p", __import__("pandas").Timestamp("2021-01-01"), g, z, z * np.nan, z * np.nan,
               z, z, z * np.nan, z, z, z, z)
    t = build_targets(s)
    # From slot 0, readings at +45 and +60 min (slots 3, 4) are both > 180.
    assert t.loc[0, "ev_hyper"] == 1
    # From slot 2, slots 3 and 4 are within 60 min and both > 180.
    assert t.loc[2, "ev_hyper"] == 1
    # From slot 5, no two consecutive readings > 180 follow.
    assert t.loc[5, "ev_hyper"] == 0
    # Slot 3 is already above 180, so it is not at risk of onset.
    assert np.isnan(t.loc[3, "ev_hyper"])
