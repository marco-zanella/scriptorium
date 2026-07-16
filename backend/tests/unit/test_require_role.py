from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient

from app.auth.dependencies import Principal, require_role
from app.auth.tokens import create_access_token

guard_probe_app = FastAPI()


@guard_probe_app.get("/protected")
def protected(principal: Principal = Depends(require_role("manage_users"))) -> dict:
    return {"user_id": principal.user_id}


client = TestClient(guard_probe_app)


def _bearer(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def test_rejects_anonymous_requests() -> None:
    response = client.get("/protected")
    assert response.status_code == 401


def test_rejects_user_without_the_required_role() -> None:
    token = create_access_token(1, roles=["use_rag"], is_superuser=False)
    response = client.get("/protected", headers=_bearer(token))
    assert response.status_code == 403


def test_allows_user_with_the_required_role() -> None:
    token = create_access_token(1, roles=["manage_users"], is_superuser=False)
    response = client.get("/protected", headers=_bearer(token))
    assert response.status_code == 200


def test_superuser_bypasses_role_check() -> None:
    token = create_access_token(1, roles=[], is_superuser=True)
    response = client.get("/protected", headers=_bearer(token))
    assert response.status_code == 200
