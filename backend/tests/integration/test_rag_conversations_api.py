import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

import app.api.rag as rag_module
from app.auth.models import User
from app.auth.tokens import create_access_token
from app.main import app
from app.rag.models import Conversation, Message


@pytest.fixture
def client() -> TestClient:
    return TestClient(app, base_url="https://testserver")


@pytest.fixture(autouse=True)
def _stub_run_turn(monkeypatch):
    """Real tool-calling/streaming behavior is covered by test_rag_loop.py -
    this file tests the router's own responsibility (ownership, role-gating,
    the double-submit guard, citation derivation), not the LLM loop."""

    def fake_run_turn(message_id: int):
        yield {"data": '{"type": "token", "text": "stub"}'}
        yield {"data": f'{{"type": "done", "message": {{"id": {message_id}}}}}'}

    monkeypatch.setattr(rag_module, "run_turn", fake_run_turn)


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


def test_create_list_get_rename_delete_own_conversation(
    client: TestClient, db_session: Session
) -> None:
    user = _create_db_user(db_session, "rag-alice")
    headers = _bearer(user.id, ["use_rag"])

    create = client.post("/api/rag/conversations", json={"title": "first"}, headers=headers)
    assert create.status_code == 201
    conv_id = create.json()["id"]
    assert create.json()["title"] == "first"

    listed = client.get("/api/rag/conversations", headers=headers)
    assert listed.status_code == 200
    assert [c["id"] for c in listed.json()] == [conv_id]

    got = client.get(f"/api/rag/conversations/{conv_id}", headers=headers)
    assert got.status_code == 200

    renamed = client.patch(
        f"/api/rag/conversations/{conv_id}", json={"title": "renamed"}, headers=headers
    )
    assert renamed.status_code == 200
    assert renamed.json()["title"] == "renamed"

    deleted = client.delete(f"/api/rag/conversations/{conv_id}", headers=headers)
    assert deleted.status_code == 204

    assert client.get(f"/api/rag/conversations/{conv_id}", headers=headers).status_code == 404


def test_cannot_see_or_delete_another_users_conversation(
    client: TestClient, db_session: Session
) -> None:
    owner = _create_db_user(db_session, "rag-bob")
    other = _create_db_user(db_session, "rag-carol")
    headers_owner = _bearer(owner.id, ["use_rag"])
    headers_other = _bearer(other.id, ["use_rag"])

    conv_id = client.post("/api/rag/conversations", json={}, headers=headers_owner).json()["id"]

    assert client.get(f"/api/rag/conversations/{conv_id}", headers=headers_other).status_code == 404
    assert (
        client.delete(f"/api/rag/conversations/{conv_id}", headers=headers_other).status_code == 404
    )


def test_superuser_sees_any_conversation(client: TestClient, db_session: Session) -> None:
    owner = _create_db_user(db_session, "rag-dave")
    superuser = _create_db_user(db_session, "rag-erin")
    headers_owner = _bearer(owner.id, ["use_rag"])
    headers_super = _bearer(superuser.id, [], is_superuser=True)

    conv_id = client.post("/api/rag/conversations", json={}, headers=headers_owner).json()["id"]

    assert client.get(f"/api/rag/conversations/{conv_id}", headers=headers_super).status_code == 200


def test_requires_use_rag_role(client: TestClient, db_session: Session) -> None:
    user = _create_db_user(db_session, "rag-frank")
    headers = _bearer(user.id, [])

    assert client.get("/api/rag/conversations", headers=headers).status_code == 403


def test_post_message_unknown_conversation_returns_404(
    client: TestClient, db_session: Session
) -> None:
    user = _create_db_user(db_session, "rag-gail")
    headers = _bearer(user.id, ["use_rag"])

    response = client.post(
        "/api/rag/conversations/999999/messages", json={"content": "hi"}, headers=headers
    )
    assert response.status_code == 404


def test_post_message_streams_and_persists_user_message(
    client: TestClient, db_session: Session
) -> None:
    user = _create_db_user(db_session, "rag-hank")
    headers = _bearer(user.id, ["use_rag"])
    conv_id = client.post("/api/rag/conversations", json={}, headers=headers).json()["id"]

    response = client.post(
        f"/api/rag/conversations/{conv_id}/messages", json={"content": "hi there"}, headers=headers
    )
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/event-stream")
    assert 'data: {"type": "token", "text": "stub"}' in response.text

    messages = client.get(f"/api/rag/conversations/{conv_id}/messages", headers=headers).json()
    assert [m["role"] for m in messages] == ["user", "assistant"]
    assert messages[0]["content"] == "hi there"


def test_post_message_double_submit_returns_409(client: TestClient, db_session: Session) -> None:
    user = _create_db_user(db_session, "rag-iris")
    headers = _bearer(user.id, ["use_rag"])
    conv_id = client.post("/api/rag/conversations", json={}, headers=headers).json()["id"]

    conversation = db_session.get(Conversation, conv_id)
    db_session.add(Message(conversation_id=conversation.id, role="assistant", status="streaming"))
    db_session.commit()

    response = client.post(
        f"/api/rag/conversations/{conv_id}/messages", json={"content": "hi"}, headers=headers
    )
    assert response.status_code == 409


def test_message_citations_derived_from_tool_invocations(
    client: TestClient, db_session: Session
) -> None:
    user = _create_db_user(db_session, "rag-jane")
    headers = _bearer(user.id, ["use_rag"])
    conv_id = client.post("/api/rag/conversations", json={}, headers=headers).json()["id"]

    conversation = db_session.get(Conversation, conv_id)
    tool_invocations = [
        {
            "name": "search_scriptorium",
            "args": {"query": "q", "language": "eng"},
            "result": {
                "hits": [
                    {
                        "id": "kjv:genesis:1:1",
                        "book": "genesis",
                        "chapter": "1",
                        "verse": "1",
                        "source": "kjv",
                        "content": "In the beginning...",
                    },
                    {
                        "id": "kjv:genesis:1:1",
                        "book": "genesis",
                        "chapter": "1",
                        "verse": "1",
                        "source": "kjv",
                        "content": "In the beginning...",
                    },
                ]
            },
        }
    ]
    db_session.add(
        Message(
            conversation_id=conversation.id,
            role="assistant",
            status="completed",
            content="Genesis 1:1 says...",
            tool_invocations=tool_invocations,
        )
    )
    db_session.commit()

    messages = client.get(f"/api/rag/conversations/{conv_id}/messages", headers=headers).json()
    assistant = messages[-1]
    assert len(assistant["citations"]) == 1
    assert assistant["citations"][0]["id"] == "kjv:genesis:1:1"
