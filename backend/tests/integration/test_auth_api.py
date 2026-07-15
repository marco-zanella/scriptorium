import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.auth.bootstrap import create_or_reset_admin
from app.main import app


@pytest.fixture
def client() -> TestClient:
    # https:// base_url so the client's cookie jar actually sends back our Secure
    # cookies (login/refresh set secure=True to match production) — the ASGI
    # transport doesn't need real TLS for this, it's just what makes httpx treat
    # the connection as a secure context.
    return TestClient(app, base_url="https://testserver")


def _create_user(db_session: Session, **kwargs):
    defaults = {"username": "alice", "email": "alice@example.com", "password": "s3cret-pw"}
    defaults.update(kwargs)
    return create_or_reset_admin(db_session, **defaults)


def _login(client: TestClient):
    return client.post("/api/auth/login", json={"username": "alice", "password": "s3cret-pw"})


def test_login_succeeds_with_correct_credentials(client: TestClient, db_session: Session) -> None:
    _create_user(db_session)

    response = _login(client)

    assert response.status_code == 200
    assert response.json()["token_type"] == "bearer"
    assert "access_token" in response.cookies
    assert "refresh_token" in response.cookies


def test_login_fails_with_wrong_password(client: TestClient, db_session: Session) -> None:
    _create_user(db_session)

    response = client.post("/api/auth/login", json={"username": "alice", "password": "wrong"})

    assert response.status_code == 401


def test_login_fails_for_unknown_user(client: TestClient, db_session: Session) -> None:
    response = client.post("/api/auth/login", json={"username": "nobody", "password": "x"})

    assert response.status_code == 401


def test_me_requires_authentication(client: TestClient) -> None:
    response = client.get("/api/auth/me")

    assert response.status_code == 401


def test_me_returns_current_user_via_cookie(client: TestClient, db_session: Session) -> None:
    _create_user(db_session)
    _login(client)

    response = client.get("/api/auth/me")

    assert response.status_code == 200
    assert response.json()["is_superuser"] is True


def test_me_returns_current_user_via_bearer_token(client: TestClient, db_session: Session) -> None:
    _create_user(db_session)
    access_token = _login(client).json()["access_token"]

    # a separate, cookie-less client proves the bearer-token path works on its own
    bearer_only_client = TestClient(app, base_url="https://testserver")
    response = bearer_only_client.get(
        "/api/auth/me", headers={"Authorization": f"Bearer {access_token}"}
    )

    assert response.status_code == 200


def test_refresh_rotates_the_token_and_invalidates_the_old_one(
    client: TestClient, db_session: Session
) -> None:
    _create_user(db_session)
    _login(client)
    old_refresh_token = client.cookies.get("refresh_token")

    first_refresh = client.post("/api/auth/refresh")
    assert first_refresh.status_code == 200

    # a fresh client with the stale token set directly on its own jar — avoids the
    # deprecated/ambiguous per-request cookies= override
    stale_client = TestClient(app, base_url="https://testserver")
    stale_client.cookies.set("refresh_token", old_refresh_token)
    reuse_old_token = stale_client.post("/api/auth/refresh")
    assert reuse_old_token.status_code == 401


def test_logout_invalidates_the_refresh_token(client: TestClient, db_session: Session) -> None:
    _create_user(db_session)
    _login(client)

    logout_response = client.post("/api/auth/logout")
    assert logout_response.status_code == 204

    refresh_after_logout = client.post("/api/auth/refresh")
    assert refresh_after_logout.status_code == 401
