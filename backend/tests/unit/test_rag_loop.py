import json

import app.rag.loop as loop_module
from app.auth.models import User
from app.rag.llm import NormalizedCall, NormalizedEvent
from app.rag.models import Conversation, Message


def _make_conversation_with_pending_assistant(
    db_session, username: str, content: str = "hi"
) -> int:
    user = User(
        username=username,
        email=f"{username}@example.com",
        password_hash="irrelevant",
        is_active=True,
        is_superuser=False,
    )
    db_session.add(user)
    db_session.commit()

    conversation = Conversation(owner_id=user.id)
    db_session.add(conversation)
    db_session.commit()

    db_session.add(Message(conversation_id=conversation.id, role="user", content=content))
    assistant = Message(conversation_id=conversation.id, role="assistant", status="pending")
    db_session.add(assistant)
    db_session.commit()
    return assistant.id


class _ScriptedProvider:
    """Each stream_chat() call consumes the next scripted event list, in
    order - one script per tool-calling iteration the loop makes."""

    def __init__(self, scripts: list[list[NormalizedEvent]]) -> None:
        self._scripts = list(scripts)

    def stream_chat(self, messages, tools):
        yield from self._scripts.pop(0)


def _event_types(events: list[dict]) -> list[str]:
    return [json.loads(e["data"])["type"] for e in events]


def test_happy_path_token_and_tool_call(db_session, monkeypatch) -> None:
    message_id = _make_conversation_with_pending_assistant(db_session, "loop-alice")

    provider = _ScriptedProvider(
        [
            [
                NormalizedEvent(
                    type="tool_calls",
                    calls=[
                        NormalizedCall(
                            id="c0",
                            name="search_scriptorium",
                            args={"query": "God created", "language": "eng"},
                        )
                    ],
                )
            ],
            [
                NormalizedEvent(type="token", text="answer"),
                NormalizedEvent(type="finish", finish_reason="stop"),
            ],
        ]
    )
    monkeypatch.setattr(loop_module, "get_provider", lambda: provider)
    # Deterministic hits - this test isn't about real retrieval (that's
    # test_rag_tools.py's/the manual dev-data check's job), just the loop's
    # own control flow around whatever the tool returns.
    monkeypatch.setattr(
        loop_module,
        "execute_search_scriptorium",
        lambda *a, **kw: {
            "hits": [
                {
                    "id": "kjv:genesis:1:1",
                    "book": "genesis",
                    "chapter": "1",
                    "verse": "1",
                    "source": "kjv",
                    "content": "...",
                }
            ]
        },
    )

    events = list(loop_module.run_turn(message_id))
    assert _event_types(events) == ["tool_call", "tool_call", "citations", "token", "done"]

    db_session.expire_all()
    message = db_session.get(Message, message_id)
    assert message.status == "completed"
    assert message.content == "answer"
    assert len(message.tool_invocations) == 1
    assert message.tool_invocations[0]["name"] == "search_scriptorium"
    assert "hits" in message.tool_invocations[0]["result"]


def test_dedupe_skips_second_identical_call(db_session, monkeypatch) -> None:
    message_id = _make_conversation_with_pending_assistant(db_session, "loop-bob")
    args = {"query": "God created", "language": "eng"}

    provider = _ScriptedProvider(
        [
            [
                NormalizedEvent(
                    type="tool_calls",
                    calls=[
                        NormalizedCall(id="c0", name="search_scriptorium", args=dict(args)),
                        NormalizedCall(id="c1", name="search_scriptorium", args=dict(args)),
                    ],
                )
            ],
            [
                NormalizedEvent(type="token", text="done"),
                NormalizedEvent(type="finish", finish_reason="stop"),
            ],
        ]
    )
    monkeypatch.setattr(loop_module, "get_provider", lambda: provider)

    call_count = {"n": 0}
    original_execute = loop_module.execute_search_scriptorium

    def counting_execute(*a, **kw):
        call_count["n"] += 1
        return original_execute(*a, **kw)

    monkeypatch.setattr(loop_module, "execute_search_scriptorium", counting_execute)

    list(loop_module.run_turn(message_id))

    assert call_count["n"] == 1
    db_session.expire_all()
    message = db_session.get(Message, message_id)
    assert len(message.tool_invocations) == 2
    assert message.tool_invocations[1]["result"] == {
        "error": "duplicate call skipped - already executed this turn"
    }


class _AlwaysCallProvider:
    def stream_chat(self, messages, tools):
        if tools:
            yield NormalizedEvent(
                type="tool_calls",
                calls=[
                    NormalizedCall(
                        id="c", name="search_scriptorium", args={"query": "x", "language": "eng"}
                    )
                ],
            )
        else:
            yield NormalizedEvent(type="token", text="forced final answer")
            yield NormalizedEvent(type="finish", finish_reason="stop")


def test_iteration_cap_forces_final_answer_without_hanging(db_session, monkeypatch) -> None:
    message_id = _make_conversation_with_pending_assistant(db_session, "loop-carol")
    monkeypatch.setattr(loop_module.settings, "rag_max_tool_iterations", 2)
    monkeypatch.setattr(loop_module, "get_provider", lambda: _AlwaysCallProvider())

    list(loop_module.run_turn(message_id))

    db_session.expire_all()
    message = db_session.get(Message, message_id)
    assert message.status == "completed"
    assert message.content == "forced final answer"
    # max_iterations=2: iteration 0 gets tools (calls once), iteration 1 is the
    # last allowed one and gets no tools, forcing final text.
    assert len(message.tool_invocations) == 1


def test_tool_result_error_is_fed_back_and_turn_still_completes(db_session, monkeypatch) -> None:
    message_id = _make_conversation_with_pending_assistant(db_session, "loop-dave")
    provider = _ScriptedProvider(
        [
            [
                NormalizedEvent(
                    type="tool_calls",
                    calls=[
                        NormalizedCall(
                            id="c0",
                            name="search_scriptorium",
                            args={"query": "x", "language": "eng"},
                        )
                    ],
                )
            ],
            [
                NormalizedEvent(type="token", text="done despite the error"),
                NormalizedEvent(type="finish", finish_reason="stop"),
            ],
        ]
    )
    monkeypatch.setattr(loop_module, "get_provider", lambda: provider)
    monkeypatch.setattr(
        loop_module, "execute_search_scriptorium", lambda *a, **kw: {"error": "opensearch down"}
    )

    events = list(loop_module.run_turn(message_id))
    assert "citations" not in _event_types(events)  # no hits -> no citations event

    db_session.expire_all()
    message = db_session.get(Message, message_id)
    assert message.status == "completed"
    assert message.content == "done despite the error"
    assert message.tool_invocations[0]["result"] == {"error": "opensearch down"}


class _PartialThenSlowProvider:
    def stream_chat(self, messages, tools):
        yield NormalizedEvent(type="token", text="partial ")
        yield NormalizedEvent(type="token", text="answer")
        yield NormalizedEvent(type="token", text=" more text never seen by the client")


def test_disconnect_persists_partial_content_and_marks_failed(db_session, monkeypatch) -> None:
    message_id = _make_conversation_with_pending_assistant(db_session, "loop-erin")
    monkeypatch.setattr(loop_module, "get_provider", lambda: _PartialThenSlowProvider())

    generator = loop_module.run_turn(message_id)
    next(generator)
    next(generator)
    generator.close()

    db_session.expire_all()
    message = db_session.get(Message, message_id)
    assert message.status == "failed"
    assert message.content == "partial answer"
    assert message.error == "Interrupted"


def test_sweep_interrupted_messages_flips_pending_and_streaming_to_failed(db_session) -> None:
    user = User(
        username="loop-frank",
        email="loop-frank@example.com",
        password_hash="irrelevant",
        is_active=True,
        is_superuser=False,
    )
    db_session.add(user)
    db_session.commit()
    conversation = Conversation(owner_id=user.id)
    db_session.add(conversation)
    db_session.commit()

    pending = Message(conversation_id=conversation.id, role="assistant", status="pending")
    streaming = Message(
        conversation_id=conversation.id, role="assistant", status="streaming", content="so far"
    )
    completed = Message(
        conversation_id=conversation.id, role="assistant", status="completed", content="done"
    )
    db_session.add_all([pending, streaming, completed])
    db_session.commit()
    pending_id, streaming_id, completed_id = pending.id, streaming.id, completed.id

    loop_module.sweep_interrupted_messages()

    db_session.expire_all()
    assert db_session.get(Message, pending_id).status == "failed"
    assert db_session.get(Message, streaming_id).status == "failed"
    assert db_session.get(Message, streaming_id).content == "so far"
    assert db_session.get(Message, completed_id).status == "completed"
