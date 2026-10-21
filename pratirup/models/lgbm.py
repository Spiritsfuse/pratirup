"""LightGBM training helpers with patient-grouped cross-validation.

Early stopping never looks at the fold being scored: inside each training
fold, a random 15% of *patients* is held out as the early-stopping set.
Out-of-fold (OOF) predictions are therefore honest estimates on unseen
patients and can be reused for conformal calibration and alert thresholds.
"""

from __future__ import annotations

from dataclasses import dataclass

import lightgbm as lgb
import numpy as np
import pandas as pd

from pratirup.config import SEED

BASE_PARAMS = {
    "learning_rate": 0.03,
    "num_leaves": 31,
    "min_data_in_leaf": 300,
    "feature_fraction": 0.8,
    "bagging_fraction": 0.8,
    "bagging_freq": 1,
    "lambda_l2": 1.0,
    "max_bin": 255,
    "verbose": -1,
    "seed": SEED,
    "deterministic": True,
    "force_row_wise": True,
}
MAX_ROUNDS = 3000
EARLY_STOP = 100


@dataclass
class CVResult:
    oof: np.ndarray           # aligned with the input rows
    best_iters: list[int]
    params: dict

    @property
    def n_iter(self) -> int:
        return int(np.median(self.best_iters))


def _objective_params(objective: str, alpha: float | None) -> dict:
    if objective == "regression":
        return {"objective": "regression", "metric": "l1"}
    if objective == "quantile":
        return {"objective": "quantile", "alpha": alpha, "metric": "quantile"}
    if objective == "binary":
        return {"objective": "binary", "metric": "binary_logloss"}
    raise ValueError(objective)


def _inner_split(patients: np.ndarray, rng: np.random.Generator, frac: float = 0.15) -> np.ndarray:
    uniq = np.unique(patients)
    k = max(1, int(round(len(uniq) * frac)))
    return np.isin(patients, rng.choice(uniq, size=k, replace=False))


Extra = tuple  # (X, y, patients, folds) of training-only augmented rows


def fit(X: pd.DataFrame, y: np.ndarray, params: dict, n_iter: int, objective: str = "regression",
        alpha: float | None = None, extra: Extra | None = None) -> lgb.Booster:
    p = {**BASE_PARAMS, **params, **_objective_params(objective, alpha)}
    if extra is not None:
        X = pd.concat([X, extra[0]], ignore_index=True)
        y = np.concatenate([y, extra[1]])
    return lgb.train(p, lgb.Dataset(X, y, free_raw_data=False), num_boost_round=n_iter)


def cross_validate(X: pd.DataFrame, y: np.ndarray, patients: np.ndarray, folds: np.ndarray,
                   params: dict | None = None, objective: str = "regression",
                   alpha: float | None = None, extra: Extra | None = None) -> CVResult:
    """`extra` holds augmented rows used for training only: they join the
    training folds, never the early-stopping set or the scored fold, and a
    patient's augmented rows are dropped whenever that patient is held out."""
    params = params or {}
    p = {**BASE_PARAMS, **params, **_objective_params(objective, alpha)}
    oof = np.full(len(y), np.nan)
    best: list[int] = []
    rng = np.random.default_rng(SEED)
    for k in np.unique(folds):
        tr, va = folds != k, folds == k
        inner = _inner_split(patients[tr], rng)
        Xtr, ytr = X[tr], y[tr]
        Xfit, yfit = Xtr[~inner], ytr[~inner]
        if extra is not None:
            Xe, ye, pe, fe = extra
            held = set(patients[tr][inner])
            keep = (fe != k) & ~np.isin(pe, list(held))
            Xfit = pd.concat([Xfit, Xe[keep]], ignore_index=True)
            yfit = np.concatenate([yfit, ye[keep]])
        dtr = lgb.Dataset(Xfit, yfit)
        des = lgb.Dataset(Xtr[inner], ytr[inner], reference=dtr)
        booster = lgb.train(p, dtr, num_boost_round=MAX_ROUNDS, valid_sets=[des],
                            callbacks=[lgb.early_stopping(EARLY_STOP, verbose=False)])
        best.append(booster.best_iteration or MAX_ROUNDS)
        oof[va] = booster.predict(X[va], num_iteration=booster.best_iteration)
    return CVResult(oof=oof, best_iters=best, params=params)
