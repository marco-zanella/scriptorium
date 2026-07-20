from datetime import UTC, datetime, timedelta

from sqlalchemy.orm import Session

from app.auth.models import User
from app.eval.models import ResultCase, ResultCollection, TestCase, TestCaseTarget, TestCollection
from app.eval.runner import run_test_collection, sweep_interrupted_runs
from app.search.models import SearchConfiguration
from app.search.service import ScoreStats, SearchResult

SAMPLE_WEIGHTS = {
    "weights": {"text": 1.0, "shingle": 0.0, "trigram": 0.0, "language": 0.0, "semantic": 0.0},
    "variant_weights": {
        "text": 0.0,
        "shingle": 0.0,
        "trigram": 0.0,
        "language": 0.0,
        "semantic": 0.0,
    },
}


def _make_user(db_session: Session, username: str) -> User:
    user = User(
        username=username,
        email=f"{username}@example.com",
        password_hash="irrelevant",
        is_active=True,
        is_superuser=False,
    )
    db_session.add(user)
    db_session.commit()
    return user


def _make_collection_with_one_case(
    db_session: Session,
    username: str,
    *,
    source: str | None = None,
    tags: list[str] | None = None,
) -> TestCollection:
    user = _make_user(db_session, username)
    config = SearchConfiguration(
        owner_id=user.id, name=f"{username}-config", weights=SAMPLE_WEIGHTS
    )
    db_session.add(config)
    db_session.commit()

    collection = TestCollection(
        owner_id=user.id,
        name=f"{username}-collection",
        search_configuration_id=config.id,
        books=[],
        sources=[],
    )
    db_session.add(collection)
    db_session.commit()

    test_case = TestCase(
        owner_id=user.id,
        content="in the beginning",
        language="eng",
        source=source,
        tags=tags or [],
    )
    db_session.add(test_case)
    db_session.commit()
    db_session.add(TestCaseTarget(test_case_id=test_case.id, target="eng:genesis:1:1", relevance=3))
    db_session.commit()

    collection.test_cases.append(test_case)
    db_session.commit()
    return collection


def test_run_test_collection_creates_result_case_and_marks_completed(
    db_session: Session, monkeypatch
) -> None:
    collection = _make_collection_with_one_case(
        db_session, "runner-alice", source="Rahlfs", tags=["creation"]
    )
    result_collection = ResultCollection(
        test_collection_id=collection.id,
        configuration_snapshot={"name": "runner-alice-config", "weights": SAMPLE_WEIGHTS},
        books_snapshot=[],
        sources_snapshot=[],
        status="pending",
    )
    db_session.add(result_collection)
    db_session.commit()

    fake_results = [{"id": "eng:genesis:1:1", "type": "verse", "score": 1.0}]
    fake_score_stats = ScoreStats(
        count=1, min=1.0, max=1.0, avg=1.0, std_deviation=0.0, percentiles={"50.0": 1.0}
    )

    def fake_search(*args, **kwargs):
        assert kwargs["include_score_stats"] is True
        return SearchResult(
            took_ms=1,
            count=1,
            page=1,
            page_size=50,
            results=fake_results,
            score_stats=fake_score_stats,
        )

    monkeypatch.setattr("app.eval.runner.search", fake_search)

    run_test_collection(result_collection.id)

    db_session.refresh(result_collection)
    assert result_collection.status == "completed"
    assert result_collection.started_at is not None
    assert result_collection.completed_at is not None

    result_case = (
        db_session.query(ResultCase)
        .filter(ResultCase.result_collection_id == result_collection.id)
        .one()
    )
    assert result_case.results == fake_results
    assert result_case.snapshot["content"] == "in the beginning"
    assert result_case.snapshot["language"] == "eng"
    assert result_case.snapshot["source"] == "Rahlfs"
    assert result_case.snapshot["tags"] == ["creation"]
    assert result_case.snapshot["targets"] == [{"target": "eng:genesis:1:1", "relevance": 3}]
    assert result_case.score_stats == {
        "count": 1,
        "min": 1.0,
        "max": 1.0,
        "avg": 1.0,
        "std_deviation": 0.0,
        "percentiles": {"50.0": 1.0},
    }


def test_run_test_collection_stores_null_score_stats_when_search_returns_none(
    db_session: Session, monkeypatch
) -> None:
    collection = _make_collection_with_one_case(db_session, "runner-erin")
    result_collection = ResultCollection(
        test_collection_id=collection.id,
        configuration_snapshot={"name": "runner-erin-config", "weights": SAMPLE_WEIGHTS},
        books_snapshot=[],
        sources_snapshot=[],
        status="pending",
    )
    db_session.add(result_collection)
    db_session.commit()

    def fake_search(*args, **kwargs):
        return SearchResult(took_ms=1, count=0, page=1, page_size=50, results=[])

    monkeypatch.setattr("app.eval.runner.search", fake_search)

    run_test_collection(result_collection.id)

    result_case = (
        db_session.query(ResultCase)
        .filter(ResultCase.result_collection_id == result_collection.id)
        .one()
    )
    assert result_case.score_stats is None
    assert result_case.snapshot["source"] is None
    assert result_case.snapshot["tags"] == []


def test_run_test_collection_marks_failed_on_exception(db_session: Session, monkeypatch) -> None:
    collection = _make_collection_with_one_case(db_session, "runner-bob")
    result_collection = ResultCollection(
        test_collection_id=collection.id,
        configuration_snapshot={"name": "runner-bob-config", "weights": SAMPLE_WEIGHTS},
        books_snapshot=[],
        sources_snapshot=[],
        status="pending",
    )
    db_session.add(result_collection)
    db_session.commit()

    def broken_search(*args, **kwargs):
        raise RuntimeError("opensearch is unreachable")

    monkeypatch.setattr("app.eval.runner.search", broken_search)

    run_test_collection(result_collection.id)

    db_session.refresh(result_collection)
    assert result_collection.status == "failed"
    assert result_collection.error == "opensearch is unreachable"
    assert result_collection.completed_at is not None

    assert (
        db_session.query(ResultCase)
        .filter(ResultCase.result_collection_id == result_collection.id)
        .count()
        == 0
    )


def test_sweep_interrupted_runs_flips_running_to_failed(db_session: Session) -> None:
    collection = _make_collection_with_one_case(db_session, "runner-carol")
    stuck = ResultCollection(
        test_collection_id=collection.id,
        configuration_snapshot={"name": "runner-carol-config", "weights": SAMPLE_WEIGHTS},
        books_snapshot=[],
        sources_snapshot=[],
        status="running",
        started_at=datetime.now(UTC) - timedelta(minutes=5),
    )
    db_session.add(stuck)
    db_session.commit()

    sweep_interrupted_runs()

    db_session.refresh(stuck)
    assert stuck.status == "failed"
    assert stuck.error == "Interrupted by server restart"


def test_sweep_interrupted_runs_leaves_completed_runs_alone(db_session: Session) -> None:
    collection = _make_collection_with_one_case(db_session, "runner-dave")
    done = ResultCollection(
        test_collection_id=collection.id,
        configuration_snapshot={"name": "runner-dave-config", "weights": SAMPLE_WEIGHTS},
        books_snapshot=[],
        sources_snapshot=[],
        status="completed",
        completed_at=datetime.now(UTC),
    )
    db_session.add(done)
    db_session.commit()

    sweep_interrupted_runs()

    db_session.refresh(done)
    assert done.status == "completed"
    assert done.error is None
