"""Local-linear-trend Kalman filter for the twin's glycaemic state.

State x = [level (mg/dL), slope (mg/dL per 15 min)]. One step = one grid slot.
Missing readings run the prediction step only, so the state's uncertainty
grows during sensor gaps. Forecasts use a damped trend: the slope decays by
`phi` per step, which keeps long-horizon extrapolation bounded.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass

import numpy as np


@dataclass(frozen=True)
class KalmanParams:
    q_level: float = 4.0     # process variance of level per step, (mg/dL)^2
    q_slope: float = 1.0     # process variance of slope per step
    r: float = 9.0           # measurement variance, (mg/dL)^2
    phi: float = 0.85        # slope damping for forecasting

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class KalmanState:
    x: np.ndarray            # shape (2,)
    P: np.ndarray            # shape (2, 2)
    n_updates: int = 0

    @property
    def level(self) -> float:
        return float(self.x[0])

    @property
    def slope(self) -> float:
        return float(self.x[1])

    @property
    def level_sd(self) -> float:
        return float(np.sqrt(max(self.P[0, 0], 0.0)))

    @property
    def slope_sd(self) -> float:
        return float(np.sqrt(max(self.P[1, 1], 0.0)))


_F = np.array([[1.0, 1.0], [0.0, 1.0]])
_H = np.array([[1.0, 0.0]])


def init_state(first_glucose: float) -> KalmanState:
    return KalmanState(x=np.array([first_glucose, 0.0]), P=np.diag([100.0, 25.0]), n_updates=1)


def step(state: KalmanState, z: float | None, p: KalmanParams) -> KalmanState:
    """Advance one slot; update with measurement z if present."""
    Q = np.diag([p.q_level, p.q_slope])
    x = _F @ state.x
    P = _F @ state.P @ _F.T + Q
    n = state.n_updates
    if z is not None and np.isfinite(z):
        y = z - (_H @ x)[0]
        S = (_H @ P @ _H.T)[0, 0] + p.r
        K = (P @ _H.T)[:, 0] / S
        x = x + K * y
        P = (np.eye(2) - np.outer(K, _H[0])) @ P
        n += 1
    return KalmanState(x=x, P=P, n_updates=n)


def filter_series(g: np.ndarray, p: KalmanParams) -> np.ndarray:
    """Run the filter over a slot-indexed series (NaN = missing).

    Returns array (n, 4): level, slope, level_sd, slope_sd after processing
    slot i (i.e. using readings at slots <= i only). Rows before the first
    reading are NaN.
    """
    n = len(g)
    out = np.full((n, 4), np.nan)
    first = np.flatnonzero(np.isfinite(g))
    if len(first) == 0:
        return out
    i0 = first[0]
    st = init_state(float(g[i0]))
    out[i0] = [st.level, st.slope, st.level_sd, st.slope_sd]
    for i in range(i0 + 1, n):
        st = step(st, float(g[i]) if np.isfinite(g[i]) else None, p)
        out[i] = [st.level, st.slope, st.level_sd, st.slope_sd]
    return out


def damped_forecast(level: np.ndarray, slope: np.ndarray, h_steps: int, phi: float) -> np.ndarray:
    """Damped-trend point forecast h steps ahead."""
    factor = sum(phi ** i for i in range(1, h_steps + 1))
    return level + slope * factor
