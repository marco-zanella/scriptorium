from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.auth.api_keys import generate_api_key
from app.auth.models import ApiToken, User
from app.main import app
from app.registry import get_language_pack, list_language_packs
from app.search.client import get_client
from app.search.index_manager import ensure_index, index_name

ENG = get_language_pack("eng")
VECTOR = [0.1] * ENG.embedding_spec.dimension
WRONG_DIMENSION_VECTOR = [0.1] * (ENG.embedding_spec.dimension - 1)


@pytest.fixture
def client() -> TestClient:
    return TestClient(app, base_url="https://testserver")


@pytest.fixture(scope="module", autouse=True)
def opensearch_test_indices():
    os_client = get_client()
    names = [ensure_index(os_client, pack) for pack in list_language_packs()]
    yield
    for name in names:
        os_client.indices.delete(index=name, ignore_unavailable=True)


def _create_token(
    db_session: Session,
    scopes: list[str],
    expires_at: datetime | None = None,
    revoked: bool = False,
) -> tuple[User, str]:
    user = User(
        username=f"ingest-user-{id(scopes)}",
        email=f"ingest-{id(scopes)}@example.com",
        password_hash="irrelevant",
        is_active=True,
        is_superuser=False,
    )
    db_session.add(user)
    db_session.flush()

    raw_key, token_hash = generate_api_key()
    token = ApiToken(
        user_id=user.id,
        name="test token",
        token_hash=token_hash,
        scopes=scopes,
        expires_at=expires_at,
        revoked_at=datetime.now(UTC) if revoked else None,
    )
    db_session.add(token)
    db_session.commit()
    return user, raw_key


def _valid_document(**overrides) -> dict:
    document = {
        "book": "genesis",
        "chapter": "1",
        "verse": "1",
        "source": "test",
        "content": "In the beginning",
        "embedding": VECTOR,
        "variant": [],
    }
    document.update(overrides)
    document.setdefault(
        "id", f"{document['source']}:{document['book']}:{document['chapter']}:{document['verse']}"
    )
    document.setdefault("type", "verse")
    return document


def _ingest_body(documents: list[dict]) -> dict:
    return {
        "model_id": ENG.embedding_spec.model_id,
        "model_revision": ENG.embedding_spec.revision,
        "dimension": ENG.embedding_spec.dimension,
        "documents": documents,
    }


def test_ingest_requires_authentication(client: TestClient) -> None:
    response = client.post("/api/ingestion/eng", json=_ingest_body([_valid_document()]))
    assert response.status_code == 401


def test_ingest_rejects_wrong_scope(client: TestClient, db_session: Session) -> None:
    _, raw_key = _create_token(db_session, scopes=["use_rag"])

    response = client.post(
        "/api/ingestion/eng",
        json=_ingest_body([_valid_document()]),
        headers={"Authorization": f"Bearer {raw_key}"},
    )

    assert response.status_code == 403


def test_ingest_rejects_revoked_key(client: TestClient, db_session: Session) -> None:
    _, raw_key = _create_token(db_session, scopes=["index_content"], revoked=True)

    response = client.post(
        "/api/ingestion/eng",
        json=_ingest_body([_valid_document()]),
        headers={"Authorization": f"Bearer {raw_key}"},
    )

    assert response.status_code == 401


def test_ingest_rejects_expired_key(client: TestClient, db_session: Session) -> None:
    _, raw_key = _create_token(
        db_session, scopes=["index_content"], expires_at=datetime.now(UTC) - timedelta(days=1)
    )

    response = client.post(
        "/api/ingestion/eng",
        json=_ingest_body([_valid_document()]),
        headers={"Authorization": f"Bearer {raw_key}"},
    )

    assert response.status_code == 401


def test_ingest_rejects_unknown_language(client: TestClient, db_session: Session) -> None:
    _, raw_key = _create_token(db_session, scopes=["index_content"])

    response = client.post(
        "/api/ingestion/xxx",
        json=_ingest_body([_valid_document()]),
        headers={"Authorization": f"Bearer {raw_key}"},
    )

    assert response.status_code == 404


def test_ingest_rejects_mismatched_model_metadata(client: TestClient, db_session: Session) -> None:
    _, raw_key = _create_token(db_session, scopes=["index_content"])
    body = _ingest_body([_valid_document()])
    body["model_id"] = "some/other-model"

    response = client.post(
        "/api/ingestion/eng", json=body, headers={"Authorization": f"Bearer {raw_key}"}
    )

    assert response.status_code == 422


def test_ingest_rejects_whole_batch_on_dimension_mismatch(
    client: TestClient, db_session: Session
) -> None:
    _, raw_key = _create_token(db_session, scopes=["index_content"])
    os_client = get_client()
    eng_index = index_name(ENG)
    os_client.indices.refresh(index=eng_index)
    before = os_client.count(index=eng_index)["count"]

    documents = [
        _valid_document(verse="1"),
        _valid_document(verse="2", embedding=WRONG_DIMENSION_VECTOR),
    ]
    response = client.post(
        "/api/ingestion/eng",
        json=_ingest_body(documents),
        headers={"Authorization": f"Bearer {raw_key}"},
    )

    assert response.status_code == 422
    os_client.indices.refresh(index=eng_index)
    after = os_client.count(index=eng_index)["count"]
    assert after == before  # no partial write


def test_ingest_succeeds_with_valid_documents(client: TestClient, db_session: Session) -> None:
    _, raw_key = _create_token(db_session, scopes=["index_content"])

    documents = [
        _valid_document(verse="1"),
        _valid_document(
            verse="2",
            variant=[{"source": "witness", "content": "variant text", "embedding": VECTOR}],
        ),
    ]
    response = client.post(
        "/api/ingestion/eng",
        json=_ingest_body(documents),
        headers={"Authorization": f"Bearer {raw_key}"},
    )

    assert response.status_code == 200
    assert response.json()["indexed_count"] == 2


def test_ingest_rejects_whole_batch_on_duplicate_id(
    client: TestClient, db_session: Session
) -> None:
    _, raw_key = _create_token(db_session, scopes=["index_content"])
    os_client = get_client()
    eng_index = index_name(ENG)
    os_client.indices.refresh(index=eng_index)
    before = os_client.count(index=eng_index)["count"]

    documents = [
        _valid_document(id="dup-id", verse="1"),
        _valid_document(id="dup-id", verse="2"),
    ]
    response = client.post(
        "/api/ingestion/eng",
        json=_ingest_body(documents),
        headers={"Authorization": f"Bearer {raw_key}"},
    )

    assert response.status_code == 422
    os_client.indices.refresh(index=eng_index)
    after = os_client.count(index=eng_index)["count"]
    assert after == before  # no partial write


def test_reingesting_same_id_upserts_in_place(client: TestClient, db_session: Session) -> None:
    _, raw_key = _create_token(db_session, scopes=["index_content"])
    os_client = get_client()
    eng_index = index_name(ENG)

    doc_id = "upsert-test-genesis-1-1"
    first = client.post(
        "/api/ingestion/eng",
        json=_ingest_body([_valid_document(id=doc_id, content="first version")]),
        headers={"Authorization": f"Bearer {raw_key}"},
    )
    assert first.status_code == 200

    second = client.post(
        "/api/ingestion/eng",
        json=_ingest_body([_valid_document(id=doc_id, content="second version")]),
        headers={"Authorization": f"Bearer {raw_key}"},
    )
    assert second.status_code == 200

    os_client.indices.refresh(index=eng_index)
    stored = os_client.get(index=eng_index, id=doc_id)
    assert stored["_source"]["content"] == "second version"
