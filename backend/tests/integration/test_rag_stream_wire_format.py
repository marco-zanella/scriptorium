import json

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

import app.api.rag as rag_module
from app.auth.models import User
from app.auth.tokens import create_access_token
from app.main import app


def test_stream_wire_format_matches_frontends_parser(db_session: Session, monkeypatch) -> None:
    """Only asserts framing/format - real loop behavior is test_rag_loop.py's
    job. Round-trips the response body through the exact \\n\\n-split /
    "data: "-strip / JSON.parse logic src/api.ts's streamMessage() uses."""

    def fake_run_turn(message_id: int):
        yield {"data": json.dumps({"type": "token", "text": "hi"})}
        yield {"data": json.dumps({"type": "done", "message": {"id": message_id}})}

    monkeypatch.setattr(rag_module, "run_turn", fake_run_turn)

    user = User(
        username="wire-alice",
        email="wire-alice@example.com",
        password_hash="irrelevant",
        is_active=True,
        is_superuser=False,
    )
    db_session.add(user)
    db_session.commit()
    headers = {"Authorization": f"Bearer {create_access_token(user.id, ['use_rag'], False)}"}

    client = TestClient(app, base_url="https://testserver")
    conv_id = client.post("/api/rag/conversations", json={}, headers=headers).json()["id"]

    response = client.post(
        f"/api/rag/conversations/{conv_id}/messages", json={"content": "hi"}, headers=headers
    )

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/event-stream")

    frames = [frame for frame in response.text.split("\n\n") if frame]
    parsed = [json.loads(frame.removeprefix("data: ")) for frame in frames]

    assert parsed[0] == {"type": "token", "text": "hi"}
    assert parsed[1]["type"] == "done"
    assert parsed[1]["message"]["id"] > 0
