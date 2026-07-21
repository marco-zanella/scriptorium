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


def _login(client: TestClient, **kwargs):
    body = {"username": "alice", "password": "s3cret-pw", **kwargs}
    return client.post("/api/auth/login", json=body)


def _refresh_cookie_expires(client: TestClient) -> float | None:
    for cookie in client.cookies.jar:
        if cookie.name == "refresh_token":
            return cookie.expires
    raise AssertionError("refresh_token cookie not found in jar")


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


def test_me_includes_username(client: TestClient, db_session: Session) -> None:
    _create_user(db_session)
    _login(client)

    response = client.get("/api/auth/me")

    assert response.json()["username"] == "alice"


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


def test_remember_me_false_sets_a_session_only_refresh_cookie(
    client: TestClient, db_session: Session
) -> None:
    _create_user(db_session)
    _login(client, remember_me=False)

    assert _refresh_cookie_expires(client) is None


def test_remember_me_true_sets_a_persistent_refresh_cookie(
    client: TestClient, db_session: Session
) -> None:
    _create_user(db_session)
    _login(client, remember_me=True)

    assert _refresh_cookie_expires(client) is not None


def test_refresh_preserves_the_remember_choice_across_rotation(
    client: TestClient, db_session: Session
) -> None:
    _create_user(db_session)
    _login(client, remember_me=True)

    client.post("/api/auth/refresh")

    assert _refresh_cookie_expires(client) is not None


def test_logout_invalidates_the_refresh_token(client: TestClient, db_session: Session) -> None:
    _create_user(db_session)
    _login(client)

    logout_response = client.post("/api/auth/logout")
    assert logout_response.status_code == 204

    refresh_after_logout = client.post("/api/auth/refresh")
    assert refresh_after_logout.status_code == 401


def test_change_password_requires_authentication(client: TestClient) -> None:
    response = client.patch(
        "/api/auth/password",
        json={"current_password": "s3cret-pw", "new_password": "new-password-123"},
    )

    assert response.status_code == 401


def test_change_password_rejects_wrong_current_password(
    client: TestClient, db_session: Session
) -> None:
    _create_user(db_session)
    _login(client)

    response = client.patch(
        "/api/auth/password",
        json={"current_password": "wrong", "new_password": "new-password-123"},
    )

    assert response.status_code == 400


def test_change_password_rejects_short_new_password(
    client: TestClient, db_session: Session
) -> None:
    _create_user(db_session)
    _login(client)

    response = client.patch(
        "/api/auth/password",
        json={"current_password": "s3cret-pw", "new_password": "short"},
    )

    assert response.status_code == 422


def test_change_password_succeeds_and_old_password_stops_working(
    client: TestClient, db_session: Session
) -> None:
    _create_user(db_session)
    _login(client)

    response = client.patch(
        "/api/auth/password",
        json={"current_password": "s3cret-pw", "new_password": "new-password-123"},
    )
    assert response.status_code == 204

    old_password_login = client.post(
        "/api/auth/login", json={"username": "alice", "password": "s3cret-pw"}
    )
    assert old_password_login.status_code == 401

    new_password_login = client.post(
        "/api/auth/login", json={"username": "alice", "password": "new-password-123"}
    )
    assert new_password_login.status_code == 200
