"""Download and verify the raw public dataset into ``data/raw/``.

Usage::

    python -m scripts.download_data
"""

from __future__ import annotations

import logging
import sys

from config.settings import DATA_JOBS_2023
from src.data_collection.dataset_loader import DatasetError, ensure_raw_files


def main() -> int:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    try:
        files = ensure_raw_files(DATA_JOBS_2023)
    except DatasetError as exc:
        logging.error("%s", exc)
        logging.error(
            "If your network blocks GitHub, download the files listed in "
            "docs/DATASET_SOURCES.md manually into data/raw/%s/.",
            DATA_JOBS_2023.key,
        )
        return 1
    for name, path in files.items():
        logging.info("Verified %-24s -> %s", name, path)
    return 0


if __name__ == "__main__":
    sys.exit(main())
