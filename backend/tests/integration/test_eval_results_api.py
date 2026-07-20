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
            "gap": 0.3,
            "confidence": 0.6,
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
        "gap": 0.3,
        "confidence": 0.6,
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


def _seed_shared_test_collection(
    db_session: Session, owner: User, *, suffix: str = ""
) -> tuple[TestCollection, dict[str, TestCase]]:
    """One test collection with 4 single-target test cases: `a`, `b`, `c`
    (used by both compared runs) and `d` (baseline-only, to verify it's
    excluded from the overlap)."""
    config = SearchConfiguration(
        owner_id=owner.id, name=f"{owner.username}-config{suffix}", weights=SAMPLE_WEIGHTS
    )
    db_session.add(config)
    db_session.commit()

    collection = TestCollection(
        owner_id=owner.id,
        name=f"{owner.username}-collection{suffix}",
        search_configuration_id=config.id,
        books=[],
        sources=[],
    )
    db_session.add(collection)
    db_session.commit()

    cases_by_key = {}
    for key in ("a", "b", "c", "d"):
        test_case = TestCase(owner_id=owner.id, content=f"query {key}", language="eng", tags=[])
        db_session.add(test_case)
        db_session.commit()
        db_session.add(TestCaseTarget(test_case_id=test_case.id, target=key, relevance=3))
        db_session.commit()
        collection.test_cases.append(test_case)
        cases_by_key[key] = test_case
    db_session.commit()

    return collection, cases_by_key


def _seed_result_collection_for_cases(
    db_session: Session,
    collection: TestCollection,
    cases_and_rankings: dict[TestCase, list[str]],
    *,
    status: str = "completed",
) -> ResultCollection:
    result_collection = ResultCollection(
        test_collection_id=collection.id,
        configuration_snapshot={"name": "cfg", "weights": SAMPLE_WEIGHTS},
        books_snapshot=[],
        sources_snapshot=[],
        status=status,
    )
    db_session.add(result_collection)
    db_session.commit()

    for test_case, ranked_ids in cases_and_rankings.items():
        target = test_case.targets[0]
        db_session.add(
            ResultCase(
                test_case_id=test_case.id,
                result_collection_id=result_collection.id,
                results=[{"id": doc_id, "type": "verse", "score": 1.0} for doc_id in ranked_ids],
                snapshot={
                    "content": test_case.content,
                    "language": test_case.language,
                    "source": None,
                    "context": None,
                    "tags": [],
                    "targets": [{"target": target.target, "relevance": target.relevance}],
                },
            )
        )
    db_session.commit()
    return result_collection


def test_compare_restricts_to_overlapping_cases_and_computes_deltas(
    client: TestClient, db_session: Session
) -> None:
    user = _create_db_user(db_session, "harold")
    headers = _bearer(user.id, ["run_experiments"])
    collection, cases = _seed_shared_test_collection(db_session, user)

    baseline = _seed_result_collection_for_cases(
        db_session,
        collection,
        {
            cases["a"]: ["a", "junk"],  # found, both sides (see below)
            cases["b"]: ["x", "y"],  # not found in baseline...
            cases["c"]: ["c", "w"],  # ...found in baseline
            cases["d"]: ["d", "zz"],  # baseline-only case, no candidate row
        },
    )
    candidate = _seed_result_collection_for_cases(
        db_session,
        collection,
        {
            cases["a"]: ["junk", "a"],  # found, both sides
            cases["b"]: ["b", "z"],  # ...found in candidate
            cases["c"]: ["p", "q"],  # not found in candidate
        },
    )

    response = client.get(
        f"/api/eval/result-collections/{baseline.id}/compare",
        params={"candidate_id": candidate.id, "k": 10, "tau": 1},
        headers=headers,
    )
    assert response.status_code == 200
    body = response.json()
    assert body["baseline_id"] == baseline.id
    assert len(body["comparisons"]) == 1

    comparison = body["comparisons"][0]
    assert comparison["candidate_id"] == candidate.id
    assert comparison["overlap_case_count"] == 3
    assert {c["test_case_id"] for c in comparison["cases"]} == {
        cases["a"].id,
        cases["b"].id,
        cases["c"].id,
    }

    # recall@10: baseline found a,c (not b) -> 2/3; candidate found a,b (not c) -> 2/3
    assert comparison["recall_at_k"]["baseline"] == pytest.approx(2 / 3)
    assert comparison["recall_at_k"]["candidate"] == pytest.approx(2 / 3)
    assert comparison["recall_at_k"]["delta"] == pytest.approx(0.0)

    # reciprocal rank: baseline [1, 0, 1] -> 2/3; candidate [0.5, 1, 0] -> 0.5
    assert comparison["reciprocal_rank"]["baseline"] == pytest.approx(2 / 3)
    assert comparison["reciprocal_rank"]["candidate"] == pytest.approx(0.5)
    assert comparison["reciprocal_rank"]["delta"] == pytest.approx(0.5 - 2 / 3)

    # McNemar: case c is baseline-only-found, case b is candidate-only-found ->
    # 1 discordant pair each way; hand-computed exact p for n=2, k=1 is 1.0
    mcnemar = comparison["found_at_k"]
    assert mcnemar["n_baseline_only"] == 1
    assert mcnemar["n_candidate_only"] == 1
    assert mcnemar["statistic"] == 1
    assert mcnemar["p_value"] == pytest.approx(1.0)

    # reciprocal_rank has 3 non-zero paired differences -> wilcoxon runs for real
    assert comparison["reciprocal_rank"]["n"] == 3
    assert comparison["reciprocal_rank"]["wilcoxon_p_value"] is not None
    assert 0.0 <= comparison["reciprocal_rank"]["wilcoxon_p_value"] <= 1.0


def test_compare_rejects_candidate_from_different_test_collection(
    client: TestClient, db_session: Session
) -> None:
    user = _create_db_user(db_session, "ingrid")
    headers = _bearer(user.id, ["run_experiments"])
    collection_one, cases_one = _seed_shared_test_collection(db_session, user, suffix="-1")
    collection_two, cases_two = _seed_shared_test_collection(db_session, user, suffix="-2")

    baseline = _seed_result_collection_for_cases(
        db_session, collection_one, {cases_one["a"]: ["a"]}
    )
    other_collection_candidate = _seed_result_collection_for_cases(
        db_session, collection_two, {cases_two["a"]: ["a"]}
    )

    response = client.get(
        f"/api/eval/result-collections/{baseline.id}/compare",
        params={"candidate_id": other_collection_candidate.id},
        headers=headers,
    )
    assert response.status_code == 400


def test_compare_rejects_baseline_listed_as_its_own_candidate(
    client: TestClient, db_session: Session
) -> None:
    user = _create_db_user(db_session, "julia")
    headers = _bearer(user.id, ["run_experiments"])
    collection, cases = _seed_shared_test_collection(db_session, user)
    baseline = _seed_result_collection_for_cases(db_session, collection, {cases["a"]: ["a"]})

    response = client.get(
        f"/api/eval/result-collections/{baseline.id}/compare",
        params={"candidate_id": baseline.id},
        headers=headers,
    )
    assert response.status_code == 400


def test_compare_rejects_non_completed_result_collection(
    client: TestClient, db_session: Session
) -> None:
    user = _create_db_user(db_session, "kevin")
    headers = _bearer(user.id, ["run_experiments"])
    collection, cases = _seed_shared_test_collection(db_session, user)
    baseline = _seed_result_collection_for_cases(db_session, collection, {cases["a"]: ["a"]})
    running_candidate = _seed_result_collection_for_cases(
        db_session, collection, {cases["a"]: ["a"]}, status="running"
    )

    response = client.get(
        f"/api/eval/result-collections/{baseline.id}/compare",
        params={"candidate_id": running_candidate.id},
        headers=headers,
    )
    assert response.status_code == 400


def test_compare_requires_visibility_of_every_candidate(
    client: TestClient, db_session: Session
) -> None:
    owner = _create_db_user(db_session, "laura")
    other = _create_db_user(db_session, "marco2")
    collection, cases = _seed_shared_test_collection(db_session, owner)
    baseline = _seed_result_collection_for_cases(db_session, collection, {cases["a"]: ["a"]})
    candidate = _seed_result_collection_for_cases(db_session, collection, {cases["a"]: ["a"]})

    response = client.get(
        f"/api/eval/result-collections/{baseline.id}/compare",
        params={"candidate_id": candidate.id},
        headers=_bearer(other.id, ["run_experiments"]),
    )
    assert response.status_code == 404
