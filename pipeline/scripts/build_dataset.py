"""Run the preprocessing pipeline and write ``data/processed`` artefacts.

Usage::

    python -m scripts.build_dataset            # download if needed, then build
    python -m scripts.build_dataset --offline  # fail instead of downloading
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
import time

from src.data_collection.dataset_loader import DatasetError, load_reference_dataset
from src.preprocessing.pipeline import run_preprocessing, save_preprocessed


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--offline", action="store_true", help="do not download missing raw files")
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")

    started = time.perf_counter()
    try:
        raw = load_reference_dataset(download=not args.offline)
    except DatasetError as exc:
        logging.error("%s", exc)
        return 1

    dataset = run_preprocessing(raw)
    save_preprocessed(dataset)
    summary = {k: v for k, v in dataset.report.items() if k not in {"top_skills", "missing_values_by_column"}}
    logging.info("Report:\n%s", json.dumps(summary, indent=2))
    logging.info("Finished in %.1f s", time.perf_counter() - started)
    return 0


if __name__ == "__main__":
    sys.exit(main())
