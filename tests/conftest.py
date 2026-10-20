import pandas as pd
import pytest

from pratirup.config import DATA_PROCESSED


@pytest.fixture(scope="session")
def tables():
    return {
        name: pd.read_parquet(DATA_PROCESSED / f"shanghai_{name}.parquet")
        for name in ("recordings", "cgm", "events")
    }
