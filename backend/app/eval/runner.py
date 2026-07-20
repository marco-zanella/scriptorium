from dataclasses import asdict
from datetime import UTC, datetime

from app.db.session import SessionLocal
from app.eval.models import ResultCase, ResultCollection
from app.registry import get_language_pack
from app.search.client import get_client
from app.search.service import search


def run_test_collection(result_collection_id: int) -> None:
    """Runs every member test case of a result_collection's parent test_collection
    against Phase 4's search, recording one result_case per case.

    Any single case's failure fails the whole run (no partial-success handling) —
    simplest default, not something a fluke in one case should be allowed to mask.
    """
    db = SessionLocal()
    try:
        result_collection = db.get(ResultCollection, result_collection_id)
        result_collection.status = "running"
        result_collection.started_at = datetime.now(UTC)
        db.commit()

        client = get_client()
        weights = result_collection.configuration_snapshot["weights"]
        for test_case in result_collection.test_collection.test_cases:
            language_pack = get_language_pack(test_case.language)
            result = search(
                client,
                language_pack,
                test_case.content,
                weights=weights.get("weights"),
                variant_weights=weights.get("variant_weights"),
                bucket_weights=weights.get("bucket_weights"),
                combiner=weights.get("combiner"),
                books=result_collection.books_snapshot,
                sources=result_collection.sources_snapshot,
                page=1,
                page_size=50,
                include_score_stats=True,
            )
            db.add(
                ResultCase(
                    test_case_id=test_case.id,
                    result_collection_id=result_collection.id,
                    results=result.results,
                    score_stats=asdict(result.score_stats) if result.score_stats else None,
                    snapshot={
                        "content": test_case.content,
                        "language": test_case.language,
                        "source": test_case.source,
                        "context": test_case.context,
                        "tags": test_case.tags,
                        "targets": [
                            {"target": t.target, "relevance": t.relevance}
                            for t in test_case.targets
                        ],
                    },
                )
            )
        db.commit()

        result_collection.status = "completed"
        result_collection.completed_at = datetime.now(UTC)
        db.commit()
    except Exception as exc:
        db.rollback()
        result_collection = db.get(ResultCollection, result_collection_id)
        result_collection.status = "failed"
        result_collection.completed_at = datetime.now(UTC)
        result_collection.error = str(exc)
        db.commit()
    finally:
        db.close()


def sweep_interrupted_runs() -> None:
    """Crash recovery: a result_collection stuck at status="running" means the
    process died mid-run (BackgroundTasks has no crash recovery of its own) —
    called once on app startup, never mid-request."""
    db = SessionLocal()
    try:
        db.query(ResultCollection).filter(ResultCollection.status == "running").update(
            {
                "status": "failed",
                "error": "Interrupted by server restart",
                "completed_at": datetime.now(UTC),
            }
        )
        db.commit()
    finally:
        db.close()
