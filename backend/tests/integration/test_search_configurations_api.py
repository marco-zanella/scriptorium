import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.auth.models import User
from app.auth.tokens import create_access_token
from app.main import app

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


def _bearer(user_id: int, roles: list[str]) -> dict:
    token = create_access_token(user_id, roles, False)
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


def test_list_includes_all_four_presets(client: TestClient, db_session: Session) -> None:
    user = _create_db_user(db_session, "alice")
    response = client.get(
        "/api/search/configurations", headers=_bearer(user.id, ["use_search_engine"])
    )
    assert response.status_code == 200
    presets = [c for c in response.json() if c["is_preset"]]
    assert {c["name"] for c in presets} == {"text reuse", "language", "semantic", "hybrid"}
    assert all(c["id"] is None for c in presets)


def test_create_and_list_own_configuration(client: TestClient, db_session: Session) -> None:
    user = _create_db_user(db_session, "bob")
    headers = _bearer(user.id, ["use_search_engine"])

    create_response = client.post(
        "/api/search/configurations",
        json={"name": "my config", "weights": SAMPLE_WEIGHTS},
        headers=headers,
    )
    assert create_response.status_code == 201
    assert create_response.json()["is_preset"] is False

    list_response = client.get("/api/search/configurations", headers=headers)
    own = [c for c in list_response.json() if not c["is_preset"]]
    assert len(own) == 1
    assert own[0]["name"] == "my config"


def test_create_rejects_preset_name_conflict(client: TestClient, db_session: Session) -> None:
    user = _create_db_user(db_session, "carol")
    response = client.post(
        "/api/search/configurations",
        json={"name": "hybrid", "weights": SAMPLE_WEIGHTS},
        headers=_bearer(user.id, ["use_search_engine"]),
    )
    assert response.status_code == 409


def test_create_rejects_duplicate_own_name(client: TestClient, db_session: Session) -> None:
    user = _create_db_user(db_session, "dave")
    headers = _bearer(user.id, ["use_search_engine"])
    body = {"name": "dupe", "weights": SAMPLE_WEIGHTS}

    assert client.post("/api/search/configurations", json=body, headers=headers).status_code == 201
    assert client.post("/api/search/configurations", json=body, headers=headers).status_code == 409


def test_delete_own_configuration(client: TestClient, db_session: Session) -> None:
    user = _create_db_user(db_session, "erin")
    headers = _bearer(user.id, ["use_search_engine"])
    created = client.post(
        "/api/search/configurations",
        json={"name": "to delete", "weights": SAMPLE_WEIGHTS},
        headers=headers,
    ).json()

    response = client.delete(f"/api/search/configurations/{created['id']}", headers=headers)
    assert response.status_code == 204


def test_cannot_delete_another_users_configuration(client: TestClient, db_session: Session) -> None:
    owner = _create_db_user(db_session, "frank")
    other = _create_db_user(db_session, "grace")
    created = client.post(
        "/api/search/configurations",
        json={"name": "franks config", "weights": SAMPLE_WEIGHTS},
        headers=_bearer(owner.id, ["use_search_engine"]),
    ).json()

    response = client.delete(
        f"/api/search/configurations/{created['id']}",
        headers=_bearer(other.id, ["use_search_engine"]),
    )
    assert response.status_code == 404


def test_update_own_configuration(client: TestClient, db_session: Session) -> None:
    user = _create_db_user(db_session, "iris")
    headers = _bearer(user.id, ["use_search_engine"])
    created = client.post(
        "/api/search/configurations",
        json={"name": "original", "weights": SAMPLE_WEIGHTS},
        headers=headers,
    ).json()

    new_weights = {
        "weights": {"text": 0.0, "shingle": 1.0, "trigram": 0.0, "language": 0.0, "semantic": 0.0},
        "variant_weights": SAMPLE_WEIGHTS["variant_weights"],
    }
    response = client.patch(
        f"/api/search/configurations/{created['id']}",
        json={"name": "renamed", "weights": new_weights},
        headers=headers,
    )

    assert response.status_code == 200
    body = response.json()
    assert body["id"] == created["id"]
    assert body["name"] == "renamed"
    assert body["weights"] == new_weights
    assert body["is_preset"] is False


def test_cannot_update_another_users_configuration(client: TestClient, db_session: Session) -> None:
    owner = _create_db_user(db_session, "jack")
    other = _create_db_user(db_session, "kate")
    created = client.post(
        "/api/search/configurations",
        json={"name": "jacks config", "weights": SAMPLE_WEIGHTS},
        headers=_bearer(owner.id, ["use_search_engine"]),
    ).json()

    response = client.patch(
        f"/api/search/configurations/{created['id']}",
        json={"name": "hijacked", "weights": SAMPLE_WEIGHTS},
        headers=_bearer(other.id, ["use_search_engine"]),
    )
    assert response.status_code == 404


def test_update_rejects_preset_name_conflict(client: TestClient, db_session: Session) -> None:
    user = _create_db_user(db_session, "leo")
    headers = _bearer(user.id, ["use_search_engine"])
    created = client.post(
        "/api/search/configurations",
        json={"name": "leos config", "weights": SAMPLE_WEIGHTS},
        headers=headers,
    ).json()

    response = client.patch(
        f"/api/search/configurations/{created['id']}",
        json={"name": "hybrid", "weights": SAMPLE_WEIGHTS},
        headers=headers,
    )
    assert response.status_code == 409


def test_update_rejects_collision_with_a_different_own_configuration(
    client: TestClient, db_session: Session
) -> None:
    user = _create_db_user(db_session, "mona")
    headers = _bearer(user.id, ["use_search_engine"])
    client.post(
        "/api/search/configurations",
        json={"name": "taken", "weights": SAMPLE_WEIGHTS},
        headers=headers,
    )
    created = client.post(
        "/api/search/configurations",
        json={"name": "to rename", "weights": SAMPLE_WEIGHTS},
        headers=headers,
    ).json()

    response = client.patch(
        f"/api/search/configurations/{created['id']}",
        json={"name": "taken", "weights": SAMPLE_WEIGHTS},
        headers=headers,
    )
    assert response.status_code == 409


def test_update_allows_keeping_the_same_name(client: TestClient, db_session: Session) -> None:
    user = _create_db_user(db_session, "nick")
    headers = _bearer(user.id, ["use_search_engine"])
    created = client.post(
        "/api/search/configurations",
        json={"name": "unchanged", "weights": SAMPLE_WEIGHTS},
        headers=headers,
    ).json()

    response = client.patch(
        f"/api/search/configurations/{created['id']}",
        json={"name": "unchanged", "weights": SAMPLE_WEIGHTS},
        headers=headers,
    )
    assert response.status_code == 200


def test_configurations_require_use_search_engine_role(
    client: TestClient, db_session: Session
) -> None:
    user = _create_db_user(db_session, "henry")
    response = client.get("/api/search/configurations", headers=_bearer(user.id, ["use_rag"]))
    assert response.status_code == 403
