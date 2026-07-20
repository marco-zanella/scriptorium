from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

import app.api.eval_test_collections as eval_test_collections_module
from app.auth.models import User
from app.auth.tokens import create_access_token
from app.main import app
from app.search.models import SearchConfiguration
from app.search.service import FacetBucket

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


@pytest.fixture(autouse=True)
def _stub_run_test_collection(monkeypatch):
    """The /run endpoint's own responsibility (creating the snapshot row and
    scheduling the task) is what this file tests — actual search execution
    is covered by test_eval_runner.py. BackgroundTasks runs synchronously
    within TestClient's request/response cycle, so without this stub every
    /run call here would hit the real search stack."""
    monkeypatch.setattr(eval_test_collections_module, "run_test_collection", lambda *a, **kw: None)


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


def _create_own_configuration(db_session: Session, owner_id: int, name: str) -> SearchConfiguration:
    config = SearchConfiguration(owner_id=owner_id, name=name, weights=SAMPLE_WEIGHTS)
    db_session.add(config)
    db_session.commit()
    return config


def test_create_and_list_own_collection(client: TestClient, db_session: Session) -> None:
    user = _create_db_user(db_session, "alice")
    headers = _bearer(user.id, ["run_experiments"])
    config = _create_own_configuration(db_session, user.id, "alice-config")

    create_response = client.post(
        "/api/eval/test-collections",
        json={"name": "genesis eval", "search_configuration_id": config.id},
        headers=headers,
    )
    assert create_response.status_code == 201
    body = create_response.json()
    assert body["name"] == "genesis eval"
    assert body["books"] == []

    list_response = client.get("/api/eval/test-collections", headers=headers)
    assert [c["id"] for c in list_response.json()] == [body["id"]]


def test_create_rejects_invisible_search_configuration(
    client: TestClient, db_session: Session
) -> None:
    owner = _create_db_user(db_session, "bob")
    other = _create_db_user(db_session, "carol")
    config = _create_own_configuration(db_session, owner.id, "bobs-config")

    response = client.post(
        "/api/eval/test-collections",
        json={"name": "x", "search_configuration_id": config.id},
        headers=_bearer(other.id, ["run_experiments"]),
    )
    assert response.status_code == 404


def test_create_allows_global_search_configuration(client: TestClient, db_session: Session) -> None:
    user = _create_db_user(db_session, "dave")
    # "hybrid" is one of the seeded global presets from Phase 5.1
    configs = client.get(
        "/api/search/configurations", headers=_bearer(user.id, ["use_search_engine"])
    ).json()
    hybrid = next(c for c in configs if c["is_preset"] and c["name"] == "hybrid")

    response = client.post(
        "/api/eval/test-collections",
        json={"name": "uses global preset", "search_configuration_id": hybrid["id"]},
        headers=_bearer(user.id, ["run_experiments"]),
    )
    assert response.status_code == 201


def test_cannot_see_another_users_collection(client: TestClient, db_session: Session) -> None:
    owner = _create_db_user(db_session, "erin")
    other = _create_db_user(db_session, "frank")
    config = _create_own_configuration(db_session, owner.id, "erins-config")
    created = client.post(
        "/api/eval/test-collections",
        json={"name": "x", "search_configuration_id": config.id},
        headers=_bearer(owner.id, ["run_experiments"]),
    ).json()

    response = client.get(
        f"/api/eval/test-collections/{created['id']}",
        headers=_bearer(other.id, ["run_experiments"]),
    )
    assert response.status_code == 404


def test_superuser_sees_any_collection(client: TestClient, db_session: Session) -> None:
    owner = _create_db_user(db_session, "grace")
    superuser = _create_db_user(db_session, "root2")
    config = _create_own_configuration(db_session, owner.id, "graces-config")
    created = client.post(
        "/api/eval/test-collections",
        json={"name": "x", "search_configuration_id": config.id},
        headers=_bearer(owner.id, ["run_experiments"]),
    ).json()

    response = client.get(
        f"/api/eval/test-collections/{created['id']}",
        headers=_bearer(superuser.id, [], is_superuser=True),
    )
    assert response.status_code == 200


def test_add_remove_member_requires_same_owner(client: TestClient, db_session: Session) -> None:
    owner = _create_db_user(db_session, "henry")
    other = _create_db_user(db_session, "iris")
    headers = _bearer(owner.id, ["run_experiments"])
    config = _create_own_configuration(db_session, owner.id, "henrys-config")
    collection = client.post(
        "/api/eval/test-collections",
        json={"name": "x", "search_configuration_id": config.id},
        headers=headers,
    ).json()

    own_case = client.post(
        "/api/eval/test-cases", json={"content": "q", "language": "eng"}, headers=headers
    ).json()
    others_case = client.post(
        "/api/eval/test-cases",
        json={"content": "q2", "language": "eng"},
        headers=_bearer(other.id, ["run_experiments"]),
    ).json()

    # can't add a test case owned by someone else
    reject_response = client.post(
        f"/api/eval/test-collections/{collection['id']}/test-cases/{others_case['id']}",
        headers=headers,
    )
    assert reject_response.status_code == 404

    add_response = client.post(
        f"/api/eval/test-collections/{collection['id']}/test-cases/{own_case['id']}",
        headers=headers,
    )
    assert add_response.status_code == 200
    assert [c["id"] for c in add_response.json()] == [own_case["id"]]

    list_response = client.get(
        f"/api/eval/test-collections/{collection['id']}/test-cases", headers=headers
    )
    assert len(list_response.json()) == 1

    remove_response = client.delete(
        f"/api/eval/test-collections/{collection['id']}/test-cases/{own_case['id']}",
        headers=headers,
    )
    assert remove_response.status_code == 200
    assert remove_response.json() == []


def test_run_creates_pending_result_collection_with_snapshot(
    client: TestClient, db_session: Session
) -> None:
    user = _create_db_user(db_session, "jack")
    headers = _bearer(user.id, ["run_experiments"])
    config = _create_own_configuration(db_session, user.id, "jacks-config")
    collection = client.post(
        "/api/eval/test-collections",
        json={
            "name": "x",
            "search_configuration_id": config.id,
            "books": ["genesis"],
            "sources": ["gottingen"],
        },
        headers=headers,
    ).json()

    run_response = client.post(
        f"/api/eval/test-collections/{collection['id']}/run", headers=headers
    )
    assert run_response.status_code == 201
    body = run_response.json()
    assert body["status"] == "pending"
    assert body["configuration_snapshot"] == {"name": "jacks-config", "weights": SAMPLE_WEIGHTS}
    assert body["books_snapshot"] == ["genesis"]
    assert body["sources_snapshot"] == ["gottingen"]

    history_response = client.get(
        f"/api/eval/test-collections/{collection['id']}/result-collections", headers=headers
    )
    assert [r["id"] for r in history_response.json()] == [body["id"]]


def test_test_case_count_reflects_membership(client: TestClient, db_session: Session) -> None:
    user = _create_db_user(db_session, "mona")
    headers = _bearer(user.id, ["run_experiments"])
    config = _create_own_configuration(db_session, user.id, "monas-config")
    collection = client.post(
        "/api/eval/test-collections",
        json={"name": "x", "search_configuration_id": config.id},
        headers=headers,
    ).json()
    assert collection["test_case_count"] == 0

    case = client.post(
        "/api/eval/test-cases", json={"content": "q", "language": "eng"}, headers=headers
    ).json()
    client.post(
        f"/api/eval/test-collections/{collection['id']}/test-cases/{case['id']}", headers=headers
    )

    list_response = client.get("/api/eval/test-collections", headers=headers)
    listed = next(c for c in list_response.json() if c["id"] == collection["id"])
    assert listed["test_case_count"] == 1


def test_content_facets_merges_and_dedupes_across_language_packs(
    client: TestClient, db_session: Session, monkeypatch
) -> None:
    user = _create_db_user(db_session, "nadia")
    headers = _bearer(user.id, ["run_experiments"])

    fake_eng = SimpleNamespace(iso_code="eng")
    fake_grc = SimpleNamespace(iso_code="grc")
    monkeypatch.setattr(
        eval_test_collections_module, "list_language_packs", lambda: [fake_eng, fake_grc]
    )

    def fake_browse_facets(_client, pack):
        if pack.iso_code == "eng":
            return {
                "book": [FacetBucket(key="genesis", count=10), FacetBucket(key="exodus", count=5)],
                "source": [FacetBucket(key="kjv", count=15)],
            }
        return {
            "book": [FacetBucket(key="genesis", count=3)],
            "source": [FacetBucket(key="rahlfs", count=3)],
        }

    monkeypatch.setattr(eval_test_collections_module, "browse_facets", fake_browse_facets)

    response = client.get("/api/eval/test-collections/content-facets", headers=headers)
    assert response.status_code == 200
    assert response.json() == {"book": ["exodus", "genesis"], "source": ["kjv", "rahlfs"]}


def test_delete_collection_requires_ownership(client: TestClient, db_session: Session) -> None:
    owner = _create_db_user(db_session, "kate")
    other = _create_db_user(db_session, "leo")
    config = _create_own_configuration(db_session, owner.id, "kates-config")
    created = client.post(
        "/api/eval/test-collections",
        json={"name": "x", "search_configuration_id": config.id},
        headers=_bearer(owner.id, ["run_experiments"]),
    ).json()

    assert (
        client.delete(
            f"/api/eval/test-collections/{created['id']}",
            headers=_bearer(other.id, ["run_experiments"]),
        ).status_code
        == 404
    )
    assert (
        client.delete(
            f"/api/eval/test-collections/{created['id']}",
            headers=_bearer(owner.id, ["run_experiments"]),
        ).status_code
        == 204
    )
