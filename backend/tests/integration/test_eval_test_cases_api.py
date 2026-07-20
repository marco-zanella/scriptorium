import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.auth.models import User
from app.auth.tokens import create_access_token
from app.main import app
from app.registry import get_language_pack
from app.search.client import get_client
from app.search.index_manager import ensure_index, index_name


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


def test_requires_run_experiments_role(client: TestClient, db_session: Session) -> None:
    user = _create_db_user(db_session, "guest")
    response = client.get("/api/eval/test-cases", headers=_bearer(user.id, ["use_rag"]))
    assert response.status_code == 403


def test_create_and_list_own_test_case(client: TestClient, db_session: Session) -> None:
    user = _create_db_user(db_session, "alice")
    headers = _bearer(user.id, ["run_experiments"])

    create_response = client.post(
        "/api/eval/test-cases",
        json={"content": "who created the world", "language": "eng", "tags": ["genesis"]},
        headers=headers,
    )
    assert create_response.status_code == 201
    body = create_response.json()
    assert body["content"] == "who created the world"
    assert body["targets"] == []

    list_response = client.get("/api/eval/test-cases", headers=headers)
    assert [c["id"] for c in list_response.json()] == [body["id"]]


def test_cannot_see_another_users_test_case(client: TestClient, db_session: Session) -> None:
    owner = _create_db_user(db_session, "bob")
    other = _create_db_user(db_session, "carol")
    headers_owner = _bearer(owner.id, ["run_experiments"])
    created = client.post(
        "/api/eval/test-cases",
        json={"content": "q", "language": "eng"},
        headers=headers_owner,
    ).json()

    response = client.get(
        f"/api/eval/test-cases/{created['id']}",
        headers=_bearer(other.id, ["run_experiments"]),
    )
    assert response.status_code == 404

    list_response = client.get(
        "/api/eval/test-cases", headers=_bearer(other.id, ["run_experiments"])
    )
    assert created["id"] not in [c["id"] for c in list_response.json()]


def test_superuser_sees_and_edits_any_test_case(client: TestClient, db_session: Session) -> None:
    owner = _create_db_user(db_session, "dave")
    superuser = _create_db_user(db_session, "root")
    created = client.post(
        "/api/eval/test-cases",
        json={"content": "q", "language": "eng"},
        headers=_bearer(owner.id, ["run_experiments"]),
    ).json()

    admin_headers = _bearer(superuser.id, [], is_superuser=True)
    get_response = client.get(f"/api/eval/test-cases/{created['id']}", headers=admin_headers)
    assert get_response.status_code == 200

    update_response = client.patch(
        f"/api/eval/test-cases/{created['id']}",
        json={"content": "edited by admin", "language": "eng"},
        headers=admin_headers,
    )
    assert update_response.status_code == 200
    assert update_response.json()["content"] == "edited by admin"


def test_update_and_delete_own_test_case(client: TestClient, db_session: Session) -> None:
    user = _create_db_user(db_session, "erin")
    headers = _bearer(user.id, ["run_experiments"])
    created = client.post(
        "/api/eval/test-cases",
        json={"content": "original", "language": "eng"},
        headers=headers,
    ).json()

    update_response = client.patch(
        f"/api/eval/test-cases/{created['id']}",
        json={
            "content": "renamed",
            "language": "grc",
            "source": "Protrepticus, Clemens of Alexandria",
            "context": "some context",
            "tags": ["x"],
        },
        headers=headers,
    )
    assert update_response.status_code == 200
    body = update_response.json()
    assert body["content"] == "renamed"
    assert body["language"] == "grc"
    assert body["source"] == "Protrepticus, Clemens of Alexandria"
    assert body["context"] == "some context"
    assert body["tags"] == ["x"]

    delete_response = client.delete(f"/api/eval/test-cases/{created['id']}", headers=headers)
    assert delete_response.status_code == 204
    assert client.get(f"/api/eval/test-cases/{created['id']}", headers=headers).status_code == 404


def test_create_and_update_reject_unknown_language(client: TestClient, db_session: Session) -> None:
    user = _create_db_user(db_session, "helen")
    headers = _bearer(user.id, ["run_experiments"])

    create_response = client.post(
        "/api/eval/test-cases",
        json={"content": "q", "language": "not-a-real-language"},
        headers=headers,
    )
    assert create_response.status_code == 422

    created = client.post(
        "/api/eval/test-cases", json={"content": "q", "language": "eng"}, headers=headers
    ).json()
    update_response = client.patch(
        f"/api/eval/test-cases/{created['id']}",
        json={"content": "q", "language": "not-a-real-language"},
        headers=headers,
    )
    assert update_response.status_code == 422


def test_add_list_update_delete_targets(client: TestClient, db_session: Session) -> None:
    user = _create_db_user(db_session, "frank")
    headers = _bearer(user.id, ["run_experiments"])
    case = client.post(
        "/api/eval/test-cases", json={"content": "q", "language": "eng"}, headers=headers
    ).json()

    add_response = client.post(
        f"/api/eval/test-cases/{case['id']}/targets",
        json={"target": "eng:genesis:1:1", "relevance": 3},
        headers=headers,
    )
    assert add_response.status_code == 201
    target = add_response.json()
    assert target["relevance"] == 3

    list_response = client.get(f"/api/eval/test-cases/{case['id']}/targets", headers=headers)
    assert len(list_response.json()) == 1

    update_response = client.patch(
        f"/api/eval/test-cases/{case['id']}/targets/{target['id']}",
        json={"target": "eng:genesis:1:1", "relevance": 1},
        headers=headers,
    )
    assert update_response.status_code == 200
    assert update_response.json()["relevance"] == 1

    delete_response = client.delete(
        f"/api/eval/test-cases/{case['id']}/targets/{target['id']}", headers=headers
    )
    assert delete_response.status_code == 204
    assert client.get(f"/api/eval/test-cases/{case['id']}/targets", headers=headers).json() == []


def test_document_lookup_requires_run_experiments_role(
    client: TestClient, db_session: Session
) -> None:
    user = _create_db_user(db_session, "ivan")
    response = client.get(
        "/api/eval/test-cases/document/eng/kjv:genesis:1:1",
        headers=_bearer(user.id, ["use_rag"]),
    )
    assert response.status_code == 403


def test_document_lookup_unknown_language_returns_422(
    client: TestClient, db_session: Session
) -> None:
    user = _create_db_user(db_session, "judy")
    response = client.get(
        "/api/eval/test-cases/document/not-a-real-language/some-id",
        headers=_bearer(user.id, ["run_experiments"]),
    )
    assert response.status_code == 422


def test_document_lookup_returns_404_when_document_missing(
    client: TestClient, db_session: Session
) -> None:
    user = _create_db_user(db_session, "kevin")
    response = client.get(
        "/api/eval/test-cases/document/eng/no-such-document",
        headers=_bearer(user.id, ["run_experiments"]),
    )
    assert response.status_code == 404


def test_document_lookup_returns_indexed_document(client: TestClient, db_session: Session) -> None:
    user = _create_db_user(db_session, "laura")
    eng = get_language_pack("eng")
    os_client = get_client()
    name = ensure_index(os_client, eng)
    try:
        os_client.index(
            index=index_name(eng),
            id="kjv:genesis:1:1-document-lookup-marker",
            body={
                "id": "kjv:genesis:1:1-document-lookup-marker",
                "type": "verse",
                "book": "genesis",
                "chapter": "1",
                "verse": "1",
                "source": "kjv",
                "content": "In the beginning God created the heaven and the earth.",
                "variant": [],
            },
            refresh=True,
        )

        response = client.get(
            "/api/eval/test-cases/document/eng/kjv:genesis:1:1-document-lookup-marker",
            headers=_bearer(user.id, ["run_experiments"]),
        )
        assert response.status_code == 200
        body = response.json()
        assert body["id"] == "kjv:genesis:1:1-document-lookup-marker"
        assert body["content"] == "In the beginning God created the heaven and the earth."
    finally:
        os_client.indices.delete(index=name, ignore_unavailable=True)


def test_rejects_duplicate_target_and_out_of_range_relevance(
    client: TestClient, db_session: Session
) -> None:
    user = _create_db_user(db_session, "grace")
    headers = _bearer(user.id, ["run_experiments"])
    case = client.post(
        "/api/eval/test-cases", json={"content": "q", "language": "eng"}, headers=headers
    ).json()

    body = {"target": "eng:genesis:1:1", "relevance": 2}
    assert (
        client.post(
            f"/api/eval/test-cases/{case['id']}/targets", json=body, headers=headers
        ).status_code
        == 201
    )
    assert (
        client.post(
            f"/api/eval/test-cases/{case['id']}/targets", json=body, headers=headers
        ).status_code
        == 409
    )

    out_of_range = client.post(
        f"/api/eval/test-cases/{case['id']}/targets",
        json={"target": "eng:genesis:1:2", "relevance": 4},
        headers=headers,
    )
    assert out_of_range.status_code == 422


def test_import_requires_run_experiments_role(client: TestClient, db_session: Session) -> None:
    user = _create_db_user(db_session, "mallory")
    response = client.post(
        "/api/eval/test-cases/import",
        json=[{"content": "q", "language": "eng"}],
        headers=_bearer(user.id, ["use_rag"]),
    )
    assert response.status_code == 403


def test_import_creates_good_rows_and_reports_bad_row(
    client: TestClient, db_session: Session
) -> None:
    user = _create_db_user(db_session, "nadia")
    headers = _bearer(user.id, ["run_experiments"])

    response = client.post(
        "/api/eval/test-cases/import",
        json=[
            {
                "content": "who created the world",
                "language": "eng",
                "tags": ["genesis"],
                "targets": [{"target": "kjv:genesis:1:1", "relevance": 3}],
            },
            {"content": "bad row", "language": "not-a-real-language"},
            {"content": "another good row", "language": "grc"},
        ],
        headers=headers,
    )
    assert response.status_code == 200
    body = response.json()

    assert len(body["created"]) == 2
    assert body["created"][0]["content"] == "who created the world"
    first_targets = body["created"][0]["targets"]
    assert [{"target": t["target"], "relevance": t["relevance"]} for t in first_targets] == [
        {"target": "kjv:genesis:1:1", "relevance": 3}
    ]
    assert body["created"][1]["content"] == "another good row"

    assert len(body["errors"]) == 1
    assert body["errors"][0]["index"] == 1
    assert "not-a-real-language" in body["errors"][0]["error"]

    list_response = client.get("/api/eval/test-cases", headers=headers)
    assert {c["content"] for c in list_response.json()} == {
        "who created the world",
        "another good row",
    }


def test_import_rejects_row_with_duplicate_target(client: TestClient, db_session: Session) -> None:
    user = _create_db_user(db_session, "oscar")
    headers = _bearer(user.id, ["run_experiments"])

    response = client.post(
        "/api/eval/test-cases/import",
        json=[
            {
                "content": "q",
                "language": "eng",
                "targets": [
                    {"target": "kjv:genesis:1:1", "relevance": 1},
                    {"target": "kjv:genesis:1:1", "relevance": 2},
                ],
            }
        ],
        headers=headers,
    )
    assert response.status_code == 200
    body = response.json()
    assert body["created"] == []
    assert len(body["errors"]) == 1
    assert body["errors"][0]["index"] == 0


def test_import_reports_schema_error_without_failing_whole_batch(
    client: TestClient, db_session: Session
) -> None:
    user = _create_db_user(db_session, "peggy")
    headers = _bearer(user.id, ["run_experiments"])

    response = client.post(
        "/api/eval/test-cases/import",
        json=[
            {"content": "good row", "language": "eng"},
            {"language": "eng"},  # missing required "content"
        ],
        headers=headers,
    )
    assert response.status_code == 200
    body = response.json()
    assert len(body["created"]) == 1
    assert body["created"][0]["content"] == "good row"
    assert len(body["errors"]) == 1
    assert body["errors"][0]["index"] == 1
