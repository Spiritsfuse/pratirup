"""Download third-party datasets from their official sources.

Raw files are never committed. ShanghaiT2DM is CC BY 4.0; CGMacros is
CC BY-NC-SA 4.0 and is only used for external evaluation.
"""

from __future__ import annotations

import hashlib
import shutil
import urllib.request
import zipfile
from pathlib import Path

from pratirup.config import DATA_RAW

SHANGHAI_URL = "https://ndownloader.figshare.com/files/42966622"
SHANGHAI_SHA256 = "59b5f5c4053a32bb6b7827844a0191597dc82228fe88ce332a189fdfc659c4cb"
SHANGHAI_DIR = DATA_RAW / "shanghai"

CGMACROS_BASE = "https://physionet.org/files/cgmacros/1.0.0/"
CGMACROS_DIR = DATA_RAW / "cgmacros"


def _sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def _fetch(url: str, dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    req = urllib.request.Request(url, headers={"User-Agent": "pratirup-research/0.1"})
    with urllib.request.urlopen(req, timeout=120) as r, dest.open("wb") as f:
        shutil.copyfileobj(r, f)


def download_shanghai(force: bool = False) -> Path:
    """Fetch and extract ShanghaiT1DM/T2DM (Zhao et al., Sci Data 2023)."""
    zip_path = SHANGHAI_DIR / "diabetes_datasets.zip"
    if force or not zip_path.exists():
        print(f"Downloading ShanghaiT2DM from {SHANGHAI_URL}")
        _fetch(SHANGHAI_URL, zip_path)
    digest = _sha256(zip_path)
    if digest != SHANGHAI_SHA256:
        raise RuntimeError(
            f"Checksum mismatch for {zip_path}: got {digest}. "
            "The upstream file changed; inspect it before continuing."
        )
    with zipfile.ZipFile(zip_path) as z:
        for name in z.namelist():
            if name.startswith("__MACOSX") or name.endswith(".DS_Store"):
                continue
            target = (SHANGHAI_DIR / name).resolve()
            if SHANGHAI_DIR.resolve() not in target.parents and target != SHANGHAI_DIR.resolve():
                raise RuntimeError(f"Unsafe path in archive: {name}")
            z.extract(name, SHANGHAI_DIR)
    print(f"ShanghaiT2DM ready in {SHANGHAI_DIR} (sha256 verified)")
    return SHANGHAI_DIR


def download_cgmacros(force: bool = False) -> Path:
    """Fetch CGMacros tabular files (no meal photos) from PhysioNet."""
    files = ["bio.csv", "gut_health_test.csv", "LICENSE.txt", "SHA256SUMS.txt"]
    for name in files:
        dest = CGMACROS_DIR / name
        if force or not dest.exists():
            print(f"Downloading CGMacros/{name}")
            _fetch(CGMACROS_BASE + name, dest)
    for i in range(1, 50):
        sid = f"CGMacros-{i:03d}"
        dest = CGMACROS_DIR / sid / f"{sid}.csv"
        if dest.exists() and not force:
            continue
        try:
            _fetch(f"{CGMACROS_BASE}{sid}/{sid}.csv", dest)
            print(f"Downloaded {sid}")
        except Exception as exc:  # several IDs in 1..49 are unused upstream
            if dest.exists():
                dest.unlink()
            print(f"Skipped {sid}: {exc}")
    return CGMACROS_DIR
