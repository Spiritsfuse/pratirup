"""Command-line entry point.

    python -m pratirup.cli download          # fetch raw datasets
    python -m pratirup.cli prepare           # build processed tables + split
    python -m pratirup.cli benchmark-dev     # CV on dev patients, fit final bundle
    python -m pratirup.cli benchmark-test    # score held-out patients (once)
    python -m pratirup.cli report            # merge results + render figures
    python -m pratirup.cli serve             # run the API + UI
"""

from __future__ import annotations

import argparse
import sys


def main(argv: list[str] | None = None) -> None:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser(prog="pratirup")
    sub = ap.add_subparsers(dest="cmd", required=True)
    d = sub.add_parser("download")
    d.add_argument("--cgmacros", action="store_true", help="also fetch CGMacros (CC BY-NC-SA 4.0)")
    sub.add_parser("prepare")
    sub.add_parser("benchmark-dev")
    t = sub.add_parser("benchmark-test")
    t.add_argument("--reason", default=None, help="required to re-run after the first evaluation")
    sub.add_parser("external")
    sub.add_parser("report")
    s = sub.add_parser("serve")
    s.add_argument("--host", default="127.0.0.1")
    s.add_argument("--port", type=int, default=8000)
    a = ap.parse_args(argv)

    if a.cmd == "download":
        from pratirup.data.download import download_cgmacros, download_shanghai
        download_shanghai()
        if a.cgmacros:
            download_cgmacros()
    elif a.cmd == "prepare":
        from pratirup.data.prepare import main as prepare
        prepare()
    elif a.cmd == "benchmark-dev":
        from pratirup.evaluation.benchmark import run_dev
        run_dev()
    elif a.cmd == "benchmark-test":
        from pratirup.evaluation.benchmark import run_test
        run_test(a.reason)
    elif a.cmd == "external":
        from pratirup.evaluation.external import run_external
        run_external()
    elif a.cmd == "report":
        from pratirup.evaluation.report import main as report
        report()
    elif a.cmd == "serve":
        import uvicorn
        uvicorn.run("pratirup.api.app:app", host=a.host, port=a.port)


if __name__ == "__main__":
    main()
