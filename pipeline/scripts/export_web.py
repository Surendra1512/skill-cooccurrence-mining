"""Export the processed real dataset for the Next.js website.

Usage::

    python -m scripts.export_web

Writes
------
public/data/meta.json             skills, roles, countries, quarters, report, normalisation trace,
                                  synonym / display-name / prerequisite dictionaries
public/data/transactions.bin.gz   every cleaned posting, grouped into weighted transactions
tests/fixtures/reference.json     mlxtend Apriori/FP-Growth results used to validate the
                                  TypeScript miners exactly

Binary layout of ``transactions.bin`` (little endian)
-----------------------------------------------------
magic   4 bytes  "SKM1"
groups  uint32   number of weighted groups
then for each group:
    role     uint8
    country  uint8
    quarter  uint8    (255 = undated)
    weight   varint   number of identical postings in the group
    n        uint8    number of skills
    skills   n × uint8 skill ids (sorted)

A group is the set of postings sharing the same skill set, role, country and
quarter. Grouping is lossless for every analysis on the website: mining with
weights is mathematically identical to mining the individual postings.
"""

from __future__ import annotations

import gzip
import json
import logging
import struct
import sys
from collections import Counter
from datetime import datetime, timezone


from config.settings import (
    DATA_JOBS_2023,
    DISPLAY_NAMES_PATH,
    PREREQUISITES_PATH,
    SYNONYMS_PATH,
    WEB_DATA_DIR,
    WEB_FIXTURE_DIR,
    MiningConfig,
)
from src.mining.association_rules import generate_rules
from src.mining.engine import mine_itemsets
from src.mining.lift_filter import filter_rules
from src.preprocessing.pipeline import load_preprocessed
from src.preprocessing.transaction_builder import one_hot_encode

UNDATED = 255


def _varint(value: int) -> bytes:
    out = bytearray()
    while True:
        byte = value & 0x7F
        value >>= 7
        if value:
            out.append(byte | 0x80)
        else:
            out.append(byte)
            return bytes(out)


def _load_json(path) -> dict:
    with path.open(encoding="utf-8") as handle:
        return json.load(handle)


def main() -> int:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    try:
        dataset = load_preprocessed()
    except FileNotFoundError as exc:
        logging.error("%s", exc)
        return 1

    postings, catalog = dataset.postings, dataset.skill_catalog
    skills = catalog["skill"].tolist()  # ordered by frequency, id = position
    if len(skills) > 255:
        raise ValueError("More than 255 skills; widen the skill id field.")
    skill_id = {s: i for i, s in enumerate(skills)}

    roles = postings["role"].value_counts().index.tolist()
    countries = postings["country"].value_counts().index.tolist()
    if len(countries) > 255 or len(roles) > 255:
        raise ValueError("Too many roles/countries for uint8 encoding.")
    quarter_series = postings["posted_at"].dt.to_period("Q").astype(str)
    quarter_series = quarter_series.where(postings["posted_at"].notna())
    quarters = sorted(quarter_series.dropna().unique().tolist())
    if len(quarters) > 254:
        raise ValueError("Too many quarters for uint8 encoding.")

    role_id = {r: i for i, r in enumerate(roles)}
    country_id = {c: i for i, c in enumerate(countries)}
    quarter_id = {q: i for i, q in enumerate(quarters)}

    groups: Counter[tuple[int, int, int, tuple[int, ...]]] = Counter()
    for skill_list, role, country, quarter in zip(
        postings["skills"], postings["role"], postings["country"], quarter_series
    ):
        key = (
            role_id[role],
            country_id[country],
            quarter_id[quarter] if isinstance(quarter, str) else UNDATED,
            tuple(sorted(skill_id[s] for s in skill_list)),
        )
        groups[key] += 1

    payload = bytearray(b"SKM1")
    payload += struct.pack("<I", len(groups))
    for (role, country, quarter, ids), weight in groups.items():
        payload += struct.pack("<BBB", role, country, quarter)
        payload += _varint(weight)
        payload += struct.pack("<B", len(ids))
        payload += bytes(ids)

    WEB_DATA_DIR.mkdir(parents=True, exist_ok=True)
    bin_path = WEB_DATA_DIR / "transactions.bin.gz"
    with gzip.open(bin_path, "wb", compresslevel=9) as handle:
        handle.write(bytes(payload))
    if sum(groups.values()) != len(postings):
        raise AssertionError("Group weights do not add up to the number of postings.")

    trace = dataset.trace
    meta = {
        "version": 1,
        "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "source": {
            "key": DATA_JOBS_2023.key,
            "title": DATA_JOBS_2023.title,
            "publisher": DATA_JOBS_2023.publisher,
            "originalUrl": DATA_JOBS_2023.original_url,
            "mirrorUrl": DATA_JOBS_2023.mirror_url,
            "licence": DATA_JOBS_2023.licence,
            "description": DATA_JOBS_2023.description,
            "files": [{"name": f.name, "sha256": f.sha256} for f in DATA_JOBS_2023.files],
        },
        "skills": [
            {
                "id": i,
                "key": row.skill,
                "label": row.label,
                "category": row.category,
                "postings": int(row.postings),
                "variants": row.raw_variants,
            }
            for i, row in enumerate(catalog.itertuples(index=False))
        ],
        "roles": roles,
        "countries": countries,
        "quarters": quarters,
        "nTransactions": int(len(postings)),
        "nGroups": len(groups),
        "report": dataset.report,
        "trace": [
            [r.raw_skill, r.cleaned, r.canonical if isinstance(r.canonical, str) else None, r.status, int(r.occurrences)]
            for r in trace.itertuples(index=False)
        ],
        "synonyms": _load_json(SYNONYMS_PATH)["mappings"],
        "displayNames": _load_json(DISPLAY_NAMES_PATH)["labels"],
        "prerequisites": _load_json(PREREQUISITES_PATH)["prerequisites"],
    }
    (WEB_DATA_DIR / "meta.json").write_text(json.dumps(meta, separators=(",", ":"), default=str), encoding="utf-8")
    logging.info("Wrote %s groups (%s postings) -> %s (%.2f MB)", f"{len(groups):,}", f"{len(postings):,}",
                 bin_path, bin_path.stat().st_size / 1e6)

    # ------------------------------------------------------------------ #
    # Reference results from mlxtend for validating the TypeScript miners
    # ------------------------------------------------------------------ #
    onehot = one_hot_encode(postings["skills"], vocabulary=skills)
    references = []
    for config in (MiningConfig("FP-Growth", 0.01, 0.30, 1.2, 3), MiningConfig("FP-Growth", 0.02, 0.30, 1.2, 4)):
        result = mine_itemsets(onehot, "FP-Growth", config.min_support, config.max_len)
        apriori = mine_itemsets(onehot, "Apriori", config.min_support, config.max_len)
        assert set(result.itemsets["itemsets"]) == set(apriori.itemsets["itemsets"])
        rules = generate_rules(result, 0.0)
        surviving = filter_rules(rules, config.min_support, config.min_confidence, config.min_lift).rules
        references.append(
            {
                "config": {"minSupport": config.min_support, "minConfidence": config.min_confidence,
                           "minLift": config.min_lift, "maxLen": config.max_len},
                "nTransactions": int(len(onehot)),
                "itemsets": sorted(
                    [[sorted(skill_id[s] for s in items), int(count)]
                     for items, count in zip(result.itemsets["itemsets"], result.itemsets["support_count"])]
                ),
                "rulesGenerated": int(len(rules)),
                "rulesSurviving": int(len(surviving)),
                "sampleRules": [
                    {
                        "antecedent": sorted(skill_id[s] for s in r.antecedents),
                        "consequent": sorted(skill_id[s] for s in r.consequents),
                        "support": float(r.support),
                        "confidence": float(r.confidence),
                        "lift": float(r.lift),
                    }
                    for r in surviving.sort_values("lift", ascending=False).head(25).itertuples()
                ],
            }
        )
        logging.info("Reference %s: %d itemsets, %d rules, %d surviving", config, len(result.itemsets),
                     len(rules), len(surviving))
    WEB_FIXTURE_DIR.mkdir(parents=True, exist_ok=True)
    (WEB_FIXTURE_DIR / "reference.json").write_text(json.dumps(references), encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main())
