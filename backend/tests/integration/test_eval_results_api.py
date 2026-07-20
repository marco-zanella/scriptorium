import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.auth.models import User
from app.auth.tokens import create_access_token
from app.eval.models import ResultCase, ResultCollection, TestCase, TestCaseTarget, TestCollection
from app.main import app
from app.search.models import SearchConfiguration

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


@pytest.fixture
def client() -> TestClient:
    return TestClient(app, base_url="https://testserver")


def _bearer(user_id: int, roles: list[str], is_superuser: bool = False) -> dict:
    token = create_access_token(user_id, roles, is_superuser)
    return {"Authorization": f"Bearer {token}"}


def _create_db_user(db_session: Session, username: str) -> User:
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


def _seed_result_collection_with_one_case(
    db_session: Session,
    owner: User,
    ranked_ids: list[str],
    targets: list[dict],
    *,
    score_stats: dict | None = None,
) -> ResultCollection:
    config = SearchConfiguration(
        owner_id=owner.id, name=f"{owner.username}-config", weights=SAMPLE_WEIGHTS
    )
    db_session.add(config)
    db_session.commit()

    collection = TestCollection(
        owner_id=owner.id,
        name=f"{owner.username}-collection",
        search_configuration_id=config.id,
        books=[],
        sources=[],
    )
    db_session.add(collection)
    db_session.commit()

    test_case = TestCase(owner_id=owner.id, content="q", language="eng", tags=[])
    db_session.add(test_case)
    db_session.commit()
    for t in targets:
        db_session.add(
            TestCaseTarget(test_case_id=test_case.id, target=t["target"], relevance=t["relevance"])
        )
    db_session.commit()
    collection.test_cases.append(test_case)
    db_session.commit()

    result_collection = ResultCollection(
        test_collection_id=collection.id,
        configuration_snapshot={"name": config.name, "weights": SAMPLE_WEIGHTS},
        books_snapshot=[],
        sources_snapshot=[],
        status="completed",
    )
    db_session.add(result_collection)
    db_session.commit()

    result_case = ResultCase(
        test_case_id=test_case.id,
        result_collection_id=result_collection.id,
        results=[{"id": doc_id, "type": "verse", "score": 1.0} for doc_id in ranked_ids],
        snapshot={
            "content": "q",
            "language": "eng",
            "source": None,
            "context": None,
            "tags": [],
            "targets": targets,
        },
        score_stats=score_stats,
    )
    db_session.add(result_case)
    db_session.commit()
    return result_collection


def test_report_computes_metrics_from_stored_results(
    client: TestClient, db_session: Session
) -> None:
    user = _create_db_user(db_session, "alice")
    headers = _bearer(user.id, ["run_experiments"])
    result_collection = _seed_result_collection_with_one_case(
        db_session,
        user,
        ranked_ids=["a", "b", "c"],
        targets=[{"target": "c", "relevance": 3}],
    )

    response = client.get(
        f"/api/eval/result-collections/{result_collection.id}",
        params={"k": 3, "tau": 1},
        headers=headers,
    )
    assert response.status_code == 200
    body = response.json()
    assert body["k"] == 3
    assert body["tau"] == 1
    # single case, target "c" found at rank 3 of 3 -> recall@3=1, precision@3=1/3, mrr=1/3
    assert body["recall_at_k"] == pytest.approx(1.0)
    assert body["precision_at_k"] == pytest.approx(1 / 3)
    assert body["mrr"] == pytest.approx(1 / 3)
    assert len(body["cases"]) == 1
    assert body["cases"][0]["test_case_id"] is not None


def test_report_tau_thresholds_relevance(client: TestClient, db_session: Session) -> None:
    user = _create_db_user(db_session, "bob")
    headers = _bearer(user.id, ["run_experiments"])
    result_collection = _seed_result_collection_with_one_case(
        db_session,
        user,
        ranked_ids=["a", "b", "c"],
        targets=[{"target": "c", "relevance": 1}],
    )

    lenient = client.get(
        f"/api/eval/result-collections/{result_collection.id}",
        params={"k": 3, "tau": 1},
        headers=headers,
    ).json()
    assert lenient["recall_at_k"] == pytest.approx(1.0)

    strict = client.get(
        f"/api/eval/result-collections/{result_collection.id}",
        params={"k": 3, "tau": 2},
        headers=headers,
    ).json()
    assert strict["recall_at_k"] == pytest.approx(0.0)


def test_case_detail_returns_raw_results_and_metrics(
    client: TestClient, db_session: Session
) -> None:
    user = _create_db_user(db_session, "carol")
    headers = _bearer(user.id, ["run_experiments"])
    result_collection = _seed_result_collection_with_one_case(
        db_session,
        user,
        ranked_ids=["a", "b", "c"],
        targets=[{"target": "c", "relevance": 3}],
    )
    report = client.get(
        f"/api/eval/result-collections/{result_collection.id}", headers=headers
    ).json()
    case_id = report["cases"][0]["result_case_id"]

    response = client.get(
        f"/api/eval/result-collections/{result_collection.id}/cases/{case_id}", headers=headers
    )
    assert response.status_code == 200
    body = response.json()
    assert [r["id"] for r in body["results"]] == ["a", "b", "c"]
    assert body["snapshot"]["targets"] == [{"target": "c", "relevance": 3}]
    assert body["score_stats"] is None


def test_case_detail_includes_score_stats_when_present(
    client: TestClient, db_session: Session
) -> None:
    user = _create_db_user(db_session, "grace")
    headers = _bearer(user.id, ["run_experiments"])
    result_collection = _seed_result_collection_with_one_case(
        db_session,
        user,
        ranked_ids=["a", "b", "c"],
        targets=[{"target": "c", "relevance": 3}],
        score_stats={
            "count": 3,
            "min": 0.5,
            "max": 1.5,
            "avg": 1.0,
            "std_deviation": 0.4,
            "percentiles": {"50.0": 1.0},
        },
    )
    report = client.get(
        f"/api/eval/result-collections/{result_collection.id}", headers=headers
    ).json()
    case_id = report["cases"][0]["result_case_id"]

    response = client.get(
        f"/api/eval/result-collections/{result_collection.id}/cases/{case_id}", headers=headers
    )
    assert response.status_code == 200
    body = response.json()
    assert body["score_stats"] == {
        "count": 3,
        "min": 0.5,
        "max": 1.5,
        "avg": 1.0,
        "std_deviation": 0.4,
        "percentiles": {"50.0": 1.0},
    }


def test_cannot_see_another_users_result_collection(
    client: TestClient, db_session: Session
) -> None:
    owner = _create_db_user(db_session, "dave")
    other = _create_db_user(db_session, "erin")
    result_collection = _seed_result_collection_with_one_case(
        db_session, owner, ranked_ids=["a"], targets=[{"target": "a", "relevance": 3}]
    )

    response = client.get(
        f"/api/eval/result-collections/{result_collection.id}",
        headers=_bearer(other.id, ["run_experiments"]),
    )
    assert response.status_code == 404


def test_superuser_sees_any_result_collection(client: TestClient, db_session: Session) -> None:
    owner = _create_db_user(db_session, "frank")
    superuser = _create_db_user(db_session, "root3")
    result_collection = _seed_result_collection_with_one_case(
        db_session, owner, ranked_ids=["a"], targets=[{"target": "a", "relevance": 3}]
    )

    response = client.get(
        f"/api/eval/result-collections/{result_collection.id}",
        headers=_bearer(superuser.id, [], is_superuser=True),
    )
    assert response.status_code == 200
