"""Builds a result collection's export ZIP — one CSV per result case plus a
manifest. Pure, no FastAPI/DB-session coupling (`test_collection_name` is
passed in explicitly rather than read off `result_collection.test_collection`,
so this never depends on a lazy-loaded relationship and stays callable with
bare, never-committed model instances)."""

import csv
import io
import json
import zipfile

from app.eval.models import ResultCase, ResultCollection
from app.eval.reporting import aggregate_result_cases, target_relevance

_CSV_FIELDS = [
    "rank",
    "id",
    "type",
    "book",
    "chapter",
    "verse",
    "source",
    "score",
    "is_target",
    "relevance",
]


def _case_csv(result_case: ResultCase) -> str:
    relevance_by_target = target_relevance(result_case)
    buf = io.StringIO()
    writer = csv.DictWriter(buf, fieldnames=_CSV_FIELDS)
    writer.writeheader()
    for rank, hit in enumerate(result_case.results, start=1):
        relevance = relevance_by_target.get(hit.get("id"))
        writer.writerow(
            {
                "rank": rank,
                "id": hit.get("id"),
                "type": hit.get("type"),
                "book": hit.get("book"),
                "chapter": hit.get("chapter"),
                "verse": hit.get("verse"),
                "source": hit.get("source"),
                "score": hit.get("score"),
                "is_target": relevance is not None,
                "relevance": relevance if relevance is not None else "",
            }
        )
    return buf.getvalue()


def build_export_zip(
    result_collection: ResultCollection,
    result_cases: list[ResultCase],
    test_collection_name: str,
    k: int,
    tau: int,
) -> bytes:
    report = aggregate_result_cases(result_cases, k, tau)
    manifest = {
        "result_collection_id": result_collection.id,
        "test_collection_id": result_collection.test_collection_id,
        "test_collection_name": test_collection_name,
        "status": result_collection.status,
        "configuration_snapshot": result_collection.configuration_snapshot,
        "books_snapshot": result_collection.books_snapshot,
        "sources_snapshot": result_collection.sources_snapshot,
        "k": k,
        "tau": tau,
        "metrics": {
            "recall_at_k": report["recall_at_k"],
            "precision_at_k": report["precision_at_k"],
            "mrr": report["mrr"],
            "ndcg_at_k": report["ndcg_at_k"],
        },
    }

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("manifest.json", json.dumps(manifest, indent=2))
        for result_case in result_cases:
            zf.writestr(f"test_case_{result_case.test_case_id}.csv", _case_csv(result_case))
    return buf.getvalue()
