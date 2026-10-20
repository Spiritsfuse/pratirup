"""SQLite persistence for the twin.

The database is rebuilt from the committed processed data and model bundle on
first start (a few seconds). Replay patients are the 20 held-out test
patients: the model never saw them during training or tuning. Live patients
are created at runtime and fed one reading at a time.
"""

from __future__ import annotations

import hashlib
import json
import sqlite3
import threading
from pathlib import Path

import numpy as np
import pandas as pd

from pratirup.config import DATA_PROCESSED, MODELS_DIR, VAR_DIR
from pratirup.data.fhir import record_to_bundle
from pratirup.features import series_by_recording
from pratirup.models.bundle import EVENT_KINDS, ModelBundle
from pratirup.twin.engine import demo_minutes, replay_outputs

SCHEMA = """
CREATE TABLE IF NOT EXISTS recording (
  rid TEXT PRIMARY KEY, patient_id TEXT, mode TEXT, source_rid TEXT,
  summary_json TEXT, fhir_json TEXT, t0 TEXT,
  start_demo INTEGER, end_demo INTEGER, n_slots INTEGER
);
CREATE TABLE IF NOT EXISTS observation (
  rid TEXT, slot INTEGER, demo_min INTEGER, ts TEXT, glucose REAL, PRIMARY KEY (rid, slot)
);
CREATE TABLE IF NOT EXISTS fingerstick (rid TEXT, demo_min INTEGER, ts TEXT, glucose REAL);
CREATE TABLE IF NOT EXISTS event (
  rid TEXT, slot INTEGER, demo_min INTEGER, ts TEXT, kind TEXT, detail TEXT,
  amount REAL, unit TEXT, category TEXT
);
CREATE TABLE IF NOT EXISTS twin_state (
  rid TEXT, slot INTEGER, demo_min INTEGER, ts TEXT, glucose REAL,
  kf_level REAL, kf_slope REAL, kf_level_sd REAL, exp_mean REAL, exp_sd REAL,
  exp_tar REAL, exp_tbr REAL, n_missing_3h REAL, issuable INTEGER,
  p_hyper REAL, p_hyper2 REAL, p_hypo REAL,
  alert_hyper INTEGER, alert_hyper2 INTEGER, alert_hypo INTEGER,
  bias_30 REAL, bias_60 REAL, bias_120 REAL,
  PRIMARY KEY (rid, slot)
);
CREATE TABLE IF NOT EXISTS forecast (
  rid TEXT, issue_slot INTEGER, horizon INTEGER, target_slot INTEGER,
  issue_demo INTEGER, target_demo INTEGER,
  yhat_pop REAL, yhat REAL, lo REAL, hi REAL, actual REAL,
  PRIMARY KEY (rid, issue_slot, horizon)
);
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
CREATE INDEX IF NOT EXISTS ix_obs ON observation (rid, demo_min);
CREATE INDEX IF NOT EXISTS ix_state ON twin_state (rid, demo_min);
CREATE INDEX IF NOT EXISTS ix_fc ON forecast (rid, horizon, issue_demo);
CREATE INDEX IF NOT EXISTS ix_ev ON event (rid, demo_min);
"""

STATE_COLS = ["rid", "slot", "demo_min", "ts", "glucose", "kf_level", "kf_slope", "kf_level_sd",
              "exp_mean", "exp_sd", "exp_tar", "exp_tbr", "n_missing_3h", "issuable",
              "p_hyper", "p_hyper2", "p_hypo", "alert_hyper", "alert_hyper2", "alert_hypo",
              "bias_30", "bias_60", "bias_120"]

ORAL_NAMES = {"rx_biguanide": "metformin", "rx_sulfonylurea": "sulfonylurea", "rx_glinide": "glinide",
              "rx_agi": "alpha-glucosidase inhibitor", "rx_dpp4": "DPP-4 inhibitor", "rx_sglt2": "SGLT2 inhibitor",
              "rx_tzd": "thiazolidinedione", "rx_glp1": "GLP-1 RA"}


def _none(v):
    if v is None:
        return None
    if isinstance(v, (float, np.floating)) and not np.isfinite(v):
        return None
    if isinstance(v, (np.integer,)):
        return int(v)
    if isinstance(v, (np.floating,)):
        return float(v)
    return v


def recording_summary(rec: pd.Series) -> dict:
    parts = []
    if rec.get("rx_insulin"):
        parts.append("insulin")
    parts += [name for k, name in ORAL_NAMES.items() if rec.get(k)]
    split = lambda x: [p.strip() for p in str(x).split(",") if p.strip() and p.strip().lower() != "none"]
    return {
        "recording_id": rec["recording_id"],
        "patient_id": rec["patient_id"],
        "display_id": f"SH-{rec['patient_id']}" + (f"·{rec['recording_id'].split('_')[1]}" if rec["recording_id"].split("_")[1] != "0" else ""),
        "age": _none(rec["age"]),
        "sex": rec["sex"],
        "bmi": _none(rec["bmi"]),
        "diabetes_duration_y": _none(rec["diabetes_duration_y"]),
        "hba1c_pct": _none(rec["hba1c_pct"]),
        "hba1c_mmolmol": _none(round(float(rec["hba1c_mmolmol"]), 1)),
        "egfr": _none(rec["egfr"]),
        "cpeptide_fasting_nmol": _none(rec["cpeptide_fasting_nmol"]),
        "regimen": parts or ["no glucose-lowering drug recorded"],
        "regimen_text": str(rec["glucose_lowering_agents"]).strip(),
        "other_agents_text": str(rec["other_agents"]).strip(),
        "complications": split(rec["complications_micro"]) + split(rec["complications_macro"]),
        "comorbidities": split(rec["comorbidities"]),
        "source": "ShanghaiT2DM (de-identified research record, CC BY 4.0)",
    }


class Store:
    def __init__(self, path: Path | None = None):
        VAR_DIR.mkdir(parents=True, exist_ok=True)
        self.path = path or VAR_DIR / "pratirup.sqlite3"
        self.lock = threading.RLock()
        self.conn = sqlite3.connect(self.path, check_same_thread=False)
        self.conn.row_factory = sqlite3.Row
        self.conn.executescript(SCHEMA)
        self.bundle = ModelBundle.load(MODELS_DIR)
        self.features: dict[str, pd.DataFrame] = {}
        self.series: dict = {}
        self.tables = {n: pd.read_parquet(DATA_PROCESSED / f"shanghai_{n}.parquet")
                       for n in ("recordings", "cgm", "events", "fingersticks")}
        self.split = json.loads((DATA_PROCESSED / "split.json").read_text())
        self._purge_live()
        self._build_if_needed()

    def _purge_live(self) -> None:
        """Live sessions are ephemeral: their twins live in memory and die with the process."""
        with self.lock, self.conn:
            live = [r[0] for r in self.conn.execute("SELECT rid FROM recording WHERE mode='live'")]
            for rid in live:
                for t in ("observation", "event", "twin_state", "forecast", "fingerstick", "recording"):
                    self.conn.execute(f"DELETE FROM {t} WHERE rid=?", (rid,))

    # ------------------------------------------------------------------
    def _fingerprint(self) -> str:
        h = hashlib.sha256()
        for p in sorted(MODELS_DIR.glob("*")):
            if p.is_file():
                h.update(p.read_bytes())
        h.update((DATA_PROCESSED / "manifest.json").read_bytes())
        h.update((DATA_PROCESSED / "split.json").read_bytes())
        # Code that shapes stored rows (features, engine, FHIR) also invalidates the cache.
        pkg = Path(__file__).resolve().parents[1]
        for p in sorted(pkg.rglob("*.py")):
            h.update(p.read_bytes())
        return h.hexdigest()[:16]

    def replay_recordings(self) -> pd.DataFrame:
        recs = self.tables["recordings"]
        return recs[recs["patient_id"].isin(self.split["test_patients"])].sort_values("recording_id")

    def _build_if_needed(self) -> None:
        fp = self._fingerprint()
        cur = self.conn.execute("SELECT value FROM meta WHERE key='fingerprint'").fetchone()
        recs = self.replay_recordings()
        self.series = series_by_recording(recs, self.tables["cgm"], self.tables["events"])
        if cur and cur["value"] == fp:
            for rid, s in self.series.items():
                from pratirup.features import build_features
                self.features[rid] = build_features(s, self.bundle.kalman)
            return
        with self.lock, self.conn:
            for t in ("recording", "observation", "fingerstick", "event", "twin_state", "forecast"):
                self.conn.execute(f"DELETE FROM {t}")
            for _, rec in recs.iterrows():
                self._write_replay(rec)
            self.conn.execute("INSERT OR REPLACE INTO meta VALUES ('fingerprint', ?)", (fp,))

    def _write_replay(self, rec: pd.Series) -> None:
        rid = rec["recording_id"]
        s = self.series[rid]
        out = replay_outputs(s, self.bundle)
        self.features[rid] = out.features
        st = out.state
        dm = st["demo_min"].to_numpy()
        obs = st[np.isfinite(st["glucose"].to_numpy())]
        self.conn.execute(
            "INSERT INTO recording VALUES (?,?,?,?,?,?,?,?,?,?)",
            (rid, rec["patient_id"], "replay", rid, json.dumps(recording_summary(rec), default=str),
             json.dumps(record_to_bundle(rec), default=str), str(s.t0), int(dm[0]),
             int(obs["demo_min"].max()), int(s.n)))
        self.conn.executemany(
            "INSERT INTO observation VALUES (?,?,?,?,?)",
            [(rid, int(r.slot), int(r.demo_min), str(r.ts), float(r.glucose)) for r in obs.itertuples()])
        fs = self.tables["fingersticks"]
        fs = fs[fs["recording_id"] == rid]
        if len(fs):
            fdm = demo_minutes(s.t0, fs["ts"])
            self.conn.executemany("INSERT INTO fingerstick VALUES (?,?,?,?)",
                                  [(rid, int(d), str(t), float(g)) for d, t, g in zip(fdm, fs["ts"], fs["glucose"])])
        ev = self.tables["events"]
        ev = ev[ev["recording_id"] == rid]
        if len(ev):
            edm = demo_minutes(s.t0, s.t0 + pd.to_timedelta(ev["slot"].to_numpy() * 15, unit="min"))
            rows = []
            for d, e in zip(edm, ev.itertuples()):
                amount, unit = None, None
                if e.kind == "meal" and pd.notna(e.grams):
                    amount, unit = float(e.grams), "g"
                elif e.kind in ("insulin", "csii_bolus", "insulin_iv") and pd.notna(e.units):
                    amount, unit = float(e.units), "IU"
                elif e.kind == "csii_basal_rate" and pd.notna(e.rate):
                    amount, unit = float(e.rate), "IU/h"
                cat = e.category if isinstance(e.category, str) else (e.classes if isinstance(e.classes, str) else None)
                rows.append((rid, int(e.slot), int(d), str(e.ts), e.kind, e.detail, amount, unit, cat))
            self.conn.executemany("INSERT INTO event VALUES (?,?,?,?,?,?,?,?,?)", rows)
        st = st.assign(rid=rid, ts=st["ts"].astype(str))
        for c in STATE_COLS:
            if c not in st.columns:
                st[c] = np.nan
        vals = st[STATE_COLS].astype(object).where(pd.notna(st[STATE_COLS]), None)
        self.conn.executemany(f"INSERT INTO twin_state VALUES ({','.join('?' * len(STATE_COLS))})",
                              [tuple(_none(v) for v in row) for row in vals.itertuples(index=False)])
        fc = out.forecasts
        slot_dm = dict(zip(st["slot"], st["demo_min"]))
        t_dm = demo_minutes(s.t0, s.t0 + pd.to_timedelta(fc["target_slot"].to_numpy() * 15, unit="min"))
        self.conn.executemany(
            "INSERT INTO forecast VALUES (?,?,?,?,?,?,?,?,?,?,?)",
            [(rid, int(r.issue_slot), int(r.horizon), int(r.target_slot), int(slot_dm[r.issue_slot]), int(td),
              float(r.yhat_pop), float(r.yhat), float(r.lo), float(r.hi), _none(r.actual))
             for r, td in zip(fc.itertuples(), t_dm)])

    # ------------------------------------------------------------------
    def query(self, sql: str, args: tuple = ()) -> list[sqlite3.Row]:
        with self.lock:
            return self.conn.execute(sql, args).fetchall()

    def one(self, sql: str, args: tuple = ()):
        with self.lock:
            return self.conn.execute(sql, args).fetchone()

    def execute_many(self, sql: str, rows: list[tuple]) -> None:
        with self.lock, self.conn:
            self.conn.executemany(sql, rows)

    def execute(self, sql: str, args: tuple = ()) -> None:
        with self.lock, self.conn:
            self.conn.execute(sql, args)
