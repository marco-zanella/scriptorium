import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.auth.models import ApiToken, Role, User
from app.auth.tokens import create_access_token
from app.main import app


@pytest.fixture
def client() -> TestClient:
    return TestClient(app, base_url="https://testserver")


def _bearer(user_id: int, roles: list[str], is_superuser: bool = False) -> dict:
    token = create_access_token(user_id, roles, is_superuser)
    return {"Authorization": f"Bearer {token}"}


def _create_db_user(
    db_session: Session, username: str, roles: list[str] | None = None, is_superuser: bool = False
) -> User:
    role_rows = db_session.query(Role).filter(Role.name.in_(roles or [])).all()
    user = User(
        username=username,
        email=f"{username}@example.com",
        password_hash="irrelevant",
        is_active=True,
        is_superuser=is_superuser,
        roles=role_rows,
    )
    db_session.add(user)
    db_session.commit()
    return user


def test_create_requires_authentication(client: TestClient) -> None:
    response = client.post("/api/api-tokens", json={"scopes": ["index_content"]})
    assert response.status_code == 401


def test_create_rejects_scope_not_held_as_role(client: TestClient, db_session: Session) -> None:
    user = _create_db_user(db_session, "alice", roles=["use_search_engine"])

    response = client.post(
        "/api/api-tokens",
        headers=_bearer(user.id, ["use_search_engine"]),
        json={"scopes": ["index_content"]},
    )

    assert response.status_code == 403


def test_create_allows_scope_held_as_role(client: TestClient, db_session: Session) -> None:
    user = _create_db_user(db_session, "bob", roles=["index_content"])

    response = client.post(
        "/api/api-tokens",
        headers=_bearer(user.id, ["index_content"]),
        json={"name": "ingestion key", "scopes": ["index_content"]},
    )

    assert response.status_code == 201
    body = response.json()
    assert body["scopes"] == ["index_content"]
    assert body["raw_key"].startswith("scriptorium_sk_")


def test_create_allows_superuser_any_scope(client: TestClient, db_session: Session) -> None:
    admin = _create_db_user(db_session, "root", is_superuser=True)

    response = client.post(
        "/api/api-tokens",
        headers=_bearer(admin.id, [], is_superuser=True),
        json={"scopes": ["index_content"]},
    )
    assert response.status_code == 201


def test_created_raw_key_is_never_returned_again(client: TestClient, db_session: Session) -> None:
    user = _create_db_user(db_session, "carol", roles=["index_content"])
    headers = _bearer(user.id, ["index_content"])

    client.post("/api/api-tokens", headers=headers, json={"scopes": ["index_content"]})
    response = client.get("/api/api-tokens", headers=headers)

    assert response.status_code == 200
    assert all("raw_key" not in token for token in response.json())
    assert all("token_hash" not in token for token in response.json())


def test_list_returns_only_own_tokens(client: TestClient, db_session: Session) -> None:
    dave = _create_db_user(db_session, "dave", roles=["index_content"])
    erin = _create_db_user(db_session, "erin", roles=["index_content"])
    client.post("/api/api-tokens", headers=_bearer(dave.id, ["index_content"]), json={"scopes": []})
    client.post("/api/api-tokens", headers=_bearer(erin.id, ["index_content"]), json={"scopes": []})

    response = client.get("/api/api-tokens", headers=_bearer(dave.id, ["index_content"]))

    assert response.status_code == 200
    tokens = db_session.query(ApiToken).filter(ApiToken.user_id == dave.id).all()
    assert len(response.json()) == len(tokens)


def test_revoke_sets_revoked_at(client: TestClient, db_session: Session) -> None:
    user = _create_db_user(db_session, "frank", roles=["index_content"])
    headers = _bearer(user.id, ["index_content"])
    created = client.post(
        "/api/api-tokens", headers=headers, json={"scopes": ["index_content"]}
    ).json()

    response = client.delete(f"/api/api-tokens/{created['id']}", headers=headers)

    assert response.status_code == 204
    token = db_session.query(ApiToken).filter(ApiToken.id == created["id"]).one()
    assert token.revoked_at is not None


def test_revoke_requires_ownership(client: TestClient, db_session: Session) -> None:
    owner = _create_db_user(db_session, "gina", roles=["index_content"])
    other = _create_db_user(db_session, "henry", roles=["index_content"])
    created = client.post(
        "/api/api-tokens",
        headers=_bearer(owner.id, ["index_content"]),
        json={"scopes": ["index_content"]},
    ).json()

    response = client.delete(
        f"/api/api-tokens/{created['id']}", headers=_bearer(other.id, ["index_content"])
    )

    assert response.status_code == 404


def test_purge_requires_authentication(client: TestClient) -> None:
    response = client.delete("/api/api-tokens/1/purge")
    assert response.status_code == 401


def test_purge_rejects_an_active_token(client: TestClient, db_session: Session) -> None:
    user = _create_db_user(db_session, "iris", roles=["index_content"])
    headers = _bearer(user.id, ["index_content"])
    created = client.post(
        "/api/api-tokens", headers=headers, json={"scopes": ["index_content"]}
    ).json()

    response = client.delete(f"/api/api-tokens/{created['id']}/purge", headers=headers)

    assert response.status_code == 409
    assert db_session.query(ApiToken).filter(ApiToken.id == created["id"]).one_or_none() is not None


def test_purge_removes_a_revoked_token(client: TestClient, db_session: Session) -> None:
    user = _create_db_user(db_session, "jack", roles=["index_content"])
    headers = _bearer(user.id, ["index_content"])
    created = client.post(
        "/api/api-tokens", headers=headers, json={"scopes": ["index_content"]}
    ).json()
    client.delete(f"/api/api-tokens/{created['id']}", headers=headers)

    response = client.delete(f"/api/api-tokens/{created['id']}/purge", headers=headers)

    assert response.status_code == 204
    assert db_session.query(ApiToken).filter(ApiToken.id == created["id"]).one_or_none() is None


def test_purge_requires_ownership(client: TestClient, db_session: Session) -> None:
    owner = _create_db_user(db_session, "kate", roles=["index_content"])
    other = _create_db_user(db_session, "liam", roles=["index_content"])
    owner_headers = _bearer(owner.id, ["index_content"])
    created = client.post(
        "/api/api-tokens", headers=owner_headers, json={"scopes": ["index_content"]}
    ).json()
    client.delete(f"/api/api-tokens/{created['id']}", headers=owner_headers)

    response = client.delete(
        f"/api/api-tokens/{created['id']}/purge", headers=_bearer(other.id, ["index_content"])
    )

    assert response.status_code == 404
