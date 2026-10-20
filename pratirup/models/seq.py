"""GRU sequence model, benchmarked against LightGBM.

Input: the last 3 h (12 slots) of CGM readings and logged events as a
sequence, plus the same context features LightGBM uses (time of day,
personal profile, clinical record, event summaries). Output: the change in
glucose at +30, +60 and +120 min, trained jointly with an L1 loss.

It exists to answer "would a deep temporal model do better?" with a
measured result rather than an assumption.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd
import torch
from torch import nn

from pratirup.config import HORIZONS_MIN, LOOKBACK_SLOTS, SEED
from pratirup.features import EVENT_FEATURES, PROFILE_FEATURES, STATIC_FEATURES, TIME_FEATURES

# Selected by dev-only tuning (scripts/tune_gru.py, results/gru_tuning.json): with the
# 38 clinical-record fields as context the GRU memorised patients and stopped after
# 3-6 epochs; without them it generalised and matched LightGBM.
CONTEXT_FEATURES = TIME_FEATURES + EVENT_FEATURES + PROFILE_FEATURES
LR = 3e-4
HIDDEN = 128
SEQ_CHANNELS = 8
Y_SCALE = 50.0


def _seq_channels(s) -> np.ndarray:
    g = s.glucose
    ch = np.zeros((s.n, SEQ_CHANNELS), dtype=np.float32)
    ch[:, 0] = np.where(np.isfinite(g), (g - 140.0) / 50.0, 0.0)
    ch[:, 1] = np.isfinite(g)
    ch[:, 2] = s.meal
    ch[:, 3] = np.nan_to_num(s.meal_carb) / 100.0
    ch[:, 4] = s.fast_units / 10.0
    ch[:, 5] = s.basal_units / 10.0
    ch[:, 6] = s.oral
    ch[:, 7] = s.secretagogue
    return ch


def sequences(series: dict, rows: pd.DataFrame) -> np.ndarray:
    """(N, LOOKBACK_SLOTS, C) windows ending at each row's slot (inclusive)."""
    out = np.zeros((len(rows), LOOKBACK_SLOTS, SEQ_CHANNELS), dtype=np.float32)
    pos = 0
    for rid, idx in rows.groupby("recording_id", sort=False).indices.items():
        ch = _seq_channels(series[rid])
        padded = np.vstack([np.zeros((LOOKBACK_SLOTS - 1, SEQ_CHANNELS), np.float32), ch])
        slots = rows["slot"].to_numpy()[idx]
        for j, s in zip(idx, slots):
            out[j] = padded[s : s + LOOKBACK_SLOTS]
        pos += len(idx)
    return out


@dataclass
class Norm:
    mean: np.ndarray
    std: np.ndarray

    def apply(self, X: np.ndarray) -> np.ndarray:
        Z = (X - self.mean) / self.std
        return np.nan_to_num(Z, nan=0.0).astype(np.float32)


class GRUForecaster(nn.Module):
    def __init__(self, n_ctx: int, hidden: int = 64):
        super().__init__()
        self.gru = nn.GRU(SEQ_CHANNELS, hidden, batch_first=True)
        self.ctx = nn.Sequential(nn.Linear(n_ctx, 64), nn.ReLU(), nn.Dropout(0.1))
        self.head = nn.Sequential(nn.Linear(hidden + 64, 64), nn.ReLU(), nn.Linear(64, len(HORIZONS_MIN)))

    def forward(self, seq: torch.Tensor, ctx: torch.Tensor) -> torch.Tensor:
        _, h = self.gru(seq)
        return self.head(torch.cat([h[-1], self.ctx(ctx)], dim=1))


def _targets(rows: pd.DataFrame) -> np.ndarray:
    return np.column_stack([rows[f"dy_{h}"].to_numpy() for h in HORIZONS_MIN]).astype(np.float32) / Y_SCALE


def _loss(pred: torch.Tensor, y: torch.Tensor) -> torch.Tensor:
    m = torch.isfinite(y)
    return torch.abs(pred[m] - y[m]).mean()


def train(seq: np.ndarray, ctx: np.ndarray, y: np.ndarray, patients: np.ndarray,
          max_epochs: int = 40, patience: int = 4, lr: float = LR,
          hidden: int = HIDDEN) -> tuple[GRUForecaster, Norm, int]:
    torch.manual_seed(SEED)
    rng = np.random.default_rng(SEED)
    uniq = np.unique(patients)
    val_p = rng.choice(uniq, size=max(1, int(round(0.15 * len(uniq)))), replace=False)
    va = np.isin(patients, val_p)
    norm = Norm(np.nanmean(ctx[~va], axis=0), np.nanstd(ctx[~va], axis=0) + 1e-6)
    C = norm.apply(ctx)
    t = lambda a: torch.from_numpy(np.ascontiguousarray(a))
    Str, Ctr, Ytr = t(seq[~va]), t(C[~va]), t(y[~va])
    Sva, Cva, Yva = t(seq[va]), t(C[va]), t(y[va])
    model = GRUForecaster(C.shape[1], hidden)
    opt = torch.optim.Adam(model.parameters(), lr=lr, weight_decay=1e-5)
    best, best_state, best_epoch, bad = np.inf, None, 0, 0
    g = torch.Generator().manual_seed(SEED)
    for epoch in range(max_epochs):
        model.train()
        perm = torch.randperm(len(Str), generator=g)
        for i in range(0, len(perm), 512):
            b = perm[i : i + 512]
            opt.zero_grad()
            loss = _loss(model(Str[b], Ctr[b]), Ytr[b])
            loss.backward()
            nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            opt.step()
        model.eval()
        with torch.no_grad():
            v = float(_loss(model(Sva, Cva), Yva))
        if v < best - 1e-5:
            best, best_epoch, bad = v, epoch + 1, 0
            best_state = {k: x.clone() for k, x in model.state_dict().items()}
        else:
            bad += 1
            if bad >= patience:
                break
    model.load_state_dict(best_state)
    return model, norm, best_epoch


def predict(model: GRUForecaster, norm: Norm, seq: np.ndarray, ctx: np.ndarray) -> np.ndarray:
    model.eval()
    with torch.no_grad():
        out = model(torch.from_numpy(seq), torch.from_numpy(norm.apply(ctx))).numpy()
    return out * Y_SCALE


def cross_validate(series: dict, rows: pd.DataFrame, context: list[str] | None = None, lr: float = LR,
                   hidden: int = HIDDEN) -> tuple[np.ndarray, list[int]]:
    """OOF predictions of dy for each horizon, shape (N, len(HORIZONS_MIN))."""
    seq = sequences(series, rows)
    ctx = rows[context or CONTEXT_FEATURES].to_numpy(dtype=np.float32)
    y = _targets(rows)
    oof = np.full((len(rows), len(HORIZONS_MIN)), np.nan, dtype=np.float32)
    epochs = []
    folds = rows["fold"].to_numpy()
    patients = rows["patient_id"].to_numpy()
    for k in np.unique(folds):
        tr, va = folds != k, folds == k
        model, norm, ep = train(seq[tr], ctx[tr], y[tr], patients[tr], lr=lr, hidden=hidden)
        oof[va] = predict(model, norm, seq[va], ctx[va])
        epochs.append(ep)
    return oof, epochs


def fit_final(series: dict, rows: pd.DataFrame) -> tuple[GRUForecaster, Norm]:
    model, norm, _ = train(sequences(series, rows), rows[CONTEXT_FEATURES].to_numpy(dtype=np.float32),
                           _targets(rows), rows["patient_id"].to_numpy())
    return model, norm


def save(model: GRUForecaster, norm: Norm, path) -> None:
    torch.save({"state": model.state_dict(), "mean": norm.mean, "std": norm.std, "hidden": model.gru.hidden_size,
                "n_ctx": len(CONTEXT_FEATURES), "context_features": CONTEXT_FEATURES}, path)


def load(path) -> tuple[GRUForecaster, Norm]:
    ck = torch.load(path, weights_only=False)
    m = GRUForecaster(ck["n_ctx"], ck.get("hidden", HIDDEN))
    m.load_state_dict(ck["state"])
    return m, Norm(ck["mean"], ck["std"])
