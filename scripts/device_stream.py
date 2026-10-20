"""Simulate a CGM device + logging app streaming into a running Pratirup API.

Takes one held-out ShanghaiT2DM recording and sends its logged events and CGM
readings to the live-ingestion endpoints in time order, one reading every
--seconds-per-reading, exactly as an integration with a device cloud would.

    python -m pratirup.cli serve                      # in one terminal
    python scripts/device_stream.py --recording 2026_0_20210916 --seconds-per-reading 1

The patient then appears in the app as "LIVE · SH-2026" and updates as data arrives.
Uses only the Python standard library plus pandas for reading the processed data.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]


def post(base: str, path: str, body: dict) -> dict:
    req = urllib.request.Request(base + path, data=json.dumps(body).encode(), method="POST",
                                 headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        raise SystemExit(f"{path} -> HTTP {e.code}: {e.read().decode()}")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--api", default="http://127.0.0.1:8000/api")
    ap.add_argument("--recording", default="2026_0_20210916")
    ap.add_argument("--seconds-per-reading", type=float, default=1.0)
    ap.add_argument("--max-readings", type=int, default=0, help="stop after N readings (0 = all)")
    a = ap.parse_args()

    proc = ROOT / "data" / "processed"
    cgm = pd.read_parquet(proc / "shanghai_cgm.parquet")
    ev = pd.read_parquet(proc / "shanghai_events.parquet")
    rec = pd.read_parquet(proc / "shanghai_recordings.parquet")
    if a.recording not in set(rec["recording_id"]):
        sys.exit(f"Unknown recording {a.recording}")
    t0 = pd.Timestamp(rec.set_index("recording_id").loc[a.recording, "start_ts"])
    cgm = cgm[cgm["recording_id"] == a.recording].sort_values("slot")
    ev = ev[ev["recording_id"] == a.recording].sort_values("slot")

    session = post(a.api, "/live/start", {"source_recording_id": a.recording, "external": True})
    rid = session["recording_id"]
    print(f"Streaming {a.recording} into live twin {rid}")

    ev_rows = list(ev.itertuples())
    j = 0
    for i, r in enumerate(cgm.itertuples()):
        ts = t0 + pd.Timedelta(minutes=15 * int(r.slot))
        while j < len(ev_rows) and ev_rows[j].slot <= r.slot:
            e = ev_rows[j]
            ets = (t0 + pd.Timedelta(minutes=15 * int(e.slot))).isoformat()
            body = {"ts": ets, "kind": e.kind, "detail": e.detail}
            if e.kind == "meal":
                body.update(grams=None if pd.isna(e.grams) else float(e.grams),
                            carb_grams=None if pd.isna(e.carb_grams) else float(e.carb_grams))
            elif e.kind in ("insulin", "csii_bolus", "insulin_iv"):
                body.update(kind="insulin", units=float(e.units), insulin_name=e.detail.split(",")[0])
            elif e.kind == "oral":
                body.update(oral_text=e.detail)
            elif e.kind == "csii_basal_rate":
                body.update(rate=float(e.rate))
            post(a.api, f"/live/{rid}/events", body)
            j += 1
        out = post(a.api, f"/live/{rid}/readings", {"ts": ts.isoformat(), "glucose": float(r.glucose)})
        f60 = next((f for f in out["forecasts"] if f["horizon"] == 60), None)
        msg = f"{ts:%d %b %H:%M}  {r.glucose:6.1f} mg/dL"
        if f60:
            msg += f"  -> 60 min {f60['yhat']:6.1f} ({f60['lo']:.0f}-{f60['hi']:.0f})"
        if out["abstain_reason"]:
            msg += f"  [{out['abstain_reason']}]"
        if out["alerts"]:
            msg += f"  ALERT {','.join(out['alerts'])}"
        print(msg, flush=True)
        if a.max_readings and i + 1 >= a.max_readings:
            break
        time.sleep(a.seconds_per_reading)


if __name__ == "__main__":
    main()
