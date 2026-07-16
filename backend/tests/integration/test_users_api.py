import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.auth.models import Role, User
from app.auth.tokens import create_access_token
from app.main import app


@pytest.fixture
def client() -> TestClient:
    return TestClient(app, base_url="https://testserver")


def _bearer(user_id: int, roles: list[str], is_superuser: bool = False) -> dict:
    token = create_access_token(user_id, roles, is_superuser)
    return {"Authorization": f"Bearer {token}"}


def _create_db_user(db_session: Session, username: str, roles: list[str] | None = None) -> User:
    role_rows = db_session.query(Role).filter(Role.name.in_(roles or [])).all()
    user = User(
        username=username,
        email=f"{username}@example.com",
        password_hash="irrelevant",
        is_active=True,
        is_superuser=False,
        roles=role_rows,
    )
    db_session.add(user)
    db_session.commit()
    return user


def test_list_users_requires_authentication(client: TestClient) -> None:
    response = client.get("/api/users")
    assert response.status_code == 401


def test_list_users_requires_manage_users_role(client: TestClient) -> None:
    response = client.get("/api/users", headers=_bearer(1, ["use_rag"]))
    assert response.status_code == 403


def test_list_users_excludes_superuser(client: TestClient, db_session: Session) -> None:
    _create_db_user(db_session, "alice")

    response = client.get("/api/users", headers=_bearer(999, [], is_superuser=True))

    assert response.status_code == 200
    usernames = [u["username"] for u in response.json()]
    assert "alice" in usernames


def test_create_user_with_roles(client: TestClient, db_session: Session) -> None:
    response = client.post(
        "/api/users",
        headers=_bearer(1, ["manage_users"]),
        json={
            "username": "bob",
            "email": "bob@example.com",
            "password": "s3cret-pw",
            "roles": ["use_search_engine"],
        },
    )

    assert response.status_code == 201
    body = response.json()
    assert body["username"] == "bob"
    assert body["roles"] == ["use_search_engine"]
    assert body["is_superuser"] is False


def test_create_user_rejects_duplicate_username(client: TestClient, db_session: Session) -> None:
    _create_db_user(db_session, "carol")

    response = client.post(
        "/api/users",
        headers=_bearer(1, ["manage_users"]),
        json={"username": "carol", "email": "carol2@example.com", "password": "s3cret-pw"},
    )

    assert response.status_code == 409


def test_create_user_rejects_manage_users_role_for_non_superuser(
    client: TestClient, db_session: Session
) -> None:
    response = client.post(
        "/api/users",
        headers=_bearer(1, ["manage_users"]),
        json={
            "username": "dave",
            "email": "dave@example.com",
            "password": "s3cret-pw",
            "roles": ["manage_users"],
        },
    )

    assert response.status_code == 403


def test_create_user_allows_manage_users_role_for_superuser(
    client: TestClient, db_session: Session
) -> None:
    response = client.post(
        "/api/users",
        headers=_bearer(1, [], is_superuser=True),
        json={
            "username": "erin",
            "email": "erin@example.com",
            "password": "s3cret-pw",
            "roles": ["manage_users"],
        },
    )

    assert response.status_code == 201
    assert response.json()["roles"] == ["manage_users"]


def test_create_user_rejects_unknown_role(client: TestClient, db_session: Session) -> None:
    response = client.post(
        "/api/users",
        headers=_bearer(1, ["manage_users"]),
        json={
            "username": "frank",
            "email": "frank@example.com",
            "password": "s3cret-pw",
            "roles": ["not_a_real_role"],
        },
    )

    assert response.status_code == 422


def test_patch_user_deactivates(client: TestClient, db_session: Session) -> None:
    user = _create_db_user(db_session, "gina")

    response = client.patch(
        f"/api/users/{user.id}", headers=_bearer(1, ["manage_users"]), json={"is_active": False}
    )

    assert response.status_code == 200
    assert response.json()["is_active"] is False


def test_superuser_account_is_not_a_valid_target(client: TestClient, db_session: Session) -> None:
    admin = User(
        username="root",
        email="root@example.com",
        password_hash="irrelevant",
        is_active=True,
        is_superuser=True,
    )
    db_session.add(admin)
    db_session.commit()

    response = client.patch(
        f"/api/users/{admin.id}", headers=_bearer(1, ["manage_users"]), json={"is_active": False}
    )

    assert response.status_code == 404


def test_patch_user_updates_username_email_and_password(
    client: TestClient, db_session: Session
) -> None:
    user = _create_db_user(db_session, "jack")
    old_hash = user.password_hash

    response = client.patch(
        f"/api/users/{user.id}",
        headers=_bearer(1, ["manage_users"]),
        json={"username": "jack2", "email": "jack2@example.com", "password": "new-password-1"},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["username"] == "jack2"
    assert body["email"] == "jack2@example.com"
    db_session.refresh(user)
    assert user.password_hash != old_hash


def test_patch_user_rejects_duplicate_username(client: TestClient, db_session: Session) -> None:
    _create_db_user(db_session, "existing")
    user = _create_db_user(db_session, "kate")

    response = client.patch(
        f"/api/users/{user.id}", headers=_bearer(1, ["manage_users"]), json={"username": "existing"}
    )

    assert response.status_code == 409


def test_delete_user(client: TestClient, db_session: Session) -> None:
    user = _create_db_user(db_session, "leo")

    response = client.delete(f"/api/users/{user.id}", headers=_bearer(1, ["manage_users"]))
    assert response.status_code == 204

    assert db_session.query(User).filter(User.id == user.id).one_or_none() is None


def test_delete_user_requires_manage_users_role(client: TestClient, db_session: Session) -> None:
    user = _create_db_user(db_session, "mona")

    response = client.delete(f"/api/users/{user.id}", headers=_bearer(1, ["use_rag"]))

    assert response.status_code == 403


def test_cannot_delete_the_superuser_account(client: TestClient, db_session: Session) -> None:
    admin = User(
        username="root2",
        email="root2@example.com",
        password_hash="irrelevant",
        is_active=True,
        is_superuser=True,
    )
    db_session.add(admin)
    db_session.commit()

    response = client.delete(f"/api/users/{admin.id}", headers=_bearer(1, ["manage_users"]))

    assert response.status_code == 404


def test_assign_and_revoke_role(client: TestClient, db_session: Session) -> None:
    user = _create_db_user(db_session, "henry")

    assign_response = client.post(
        f"/api/users/{user.id}/roles/use_rag", headers=_bearer(1, ["manage_users"])
    )
    assert assign_response.status_code == 200
    assert "use_rag" in assign_response.json()["roles"]

    revoke_response = client.delete(
        f"/api/users/{user.id}/roles/use_rag", headers=_bearer(1, ["manage_users"])
    )
    assert revoke_response.status_code == 200
    assert "use_rag" not in revoke_response.json()["roles"]


def test_revoke_manage_users_requires_superuser(client: TestClient, db_session: Session) -> None:
    user = _create_db_user(db_session, "iris", roles=["manage_users"])

    response = client.delete(
        f"/api/users/{user.id}/roles/manage_users", headers=_bearer(1, ["manage_users"])
    )

    assert response.status_code == 403
