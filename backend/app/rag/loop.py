import json
import time
from collections.abc import Iterator

from app.core.config import settings
from app.db.session import SessionLocal
from app.rag.citations import citations_from_hits, citations_from_tool_invocations
from app.rag.constants import build_system_prompt
from app.rag.history import build_provider_messages
from app.rag.llm import get_provider
from app.rag.models import Message
from app.rag.tools import build_tool_schema, dedupe_key, execute_search_scriptorium
from app.search.client import get_client

# Partial-persistence throttle during token streaming - bounds how much is
# lost if the process dies mid-turn, without committing on every single token.
FLUSH_TOKEN_INTERVAL = 40
FLUSH_TIME_INTERVAL_SECONDS = 1.0


def _event(payload: dict) -> dict:
    return {"data": json.dumps(payload)}


def run_turn(message_id: int) -> Iterator[dict]:
    """Owns its own SessionLocal() - never the request's session, since this
    generator can outlive the request's DI scope (both on normal completion,
    which happens after the HTTP response has already started streaming, and
    on cancellation - see the except block below).

    Yields dicts shaped for sse_starlette.EventSourceResponse: {"data": <json
    string>}, where the JSON payload is itself {"type": ..., ...}
    -discriminated (token/tool_call/citations/done/error). The router wraps
    this generator with EventSourceResponse(..., sep="\\n") so the wire format
    is exactly `data: <json>\\n\\n` per event, matching the frontend's parser.
    """
    db = SessionLocal()
    accumulated_text = ""
    tool_invocations: list[dict] = []
    try:
        message = db.get(Message, message_id)
        conversation = message.conversation

        messages = [{"role": "system", "content": build_system_prompt()}]
        messages += build_provider_messages(conversation, settings.llm_provider)

        message.status = "streaming"
        db.commit()

        provider = get_provider()
        client = get_client()
        executed: set[tuple] = set()
        tokens_since_flush = 0
        last_flush = time.monotonic()
        max_iterations = settings.rag_max_tool_iterations

        for iteration in range(max_iterations):
            # On the last allowed iteration, omit tools entirely so the
            # provider is forced to produce final text instead of requesting
            # another call - bounded termination, never a hang or a raise.
            tools = [build_tool_schema()] if iteration < max_iterations - 1 else None
            # Sticky for the whole iteration: a single stream_chat() call can
            # emit a tool_calls event *and then* a trailing finish event in the
            # same call (observed live with Ollama, which sends a final
            # empty-content done chunk right after the tool-calls chunk) - a
            # later finish must never un-flag an iteration that already made a
            # tool call, or the loop ends one iteration early with no final
            # answer.
            saw_tool_calls = False

            for event in provider.stream_chat(messages, tools):
                if event.type == "token":
                    accumulated_text += event.text or ""
                    tokens_since_flush += 1
                    yield _event({"type": "token", "text": event.text})

                    now = time.monotonic()
                    if (
                        tokens_since_flush >= FLUSH_TOKEN_INTERVAL
                        or now - last_flush >= FLUSH_TIME_INTERVAL_SECONDS
                    ):
                        message.content = accumulated_text
                        message.tool_invocations = tool_invocations
                        db.commit()
                        tokens_since_flush = 0
                        last_flush = now

                elif event.type == "tool_calls":
                    saw_tool_calls = True
                    for call in event.calls:
                        key = dedupe_key(call.name, call.args)
                        if call.error is not None:
                            result = {"error": call.error}
                        elif key in executed:
                            result = {
                                "error": "duplicate call skipped - already executed this turn"
                            }
                        else:
                            yield _event(
                                {
                                    "type": "tool_call",
                                    "status": "running",
                                    "name": call.name,
                                    "args": call.args,
                                }
                            )
                            result = execute_search_scriptorium(
                                client,
                                query=call.args.get("query", ""),
                                language=call.args.get("language", ""),
                                books=call.args.get("books"),
                                sources=call.args.get("sources"),
                            )
                            executed.add(key)
                            yield _event(
                                {
                                    "type": "tool_call",
                                    "status": "done",
                                    "name": call.name,
                                    "args": call.args,
                                }
                            )
                            hits = result.get("hits", [])
                            if hits:
                                yield _event(
                                    {"type": "citations", "citations": citations_from_hits(hits)}
                                )

                        tool_invocations.append(
                            {"name": call.name, "args": call.args, "result": result}
                        )

                        if settings.llm_provider == "openrouter":
                            messages.append(
                                {
                                    "role": "assistant",
                                    "content": None,
                                    "tool_calls": [
                                        {
                                            "id": call.id,
                                            "type": "function",
                                            "function": {
                                                "name": call.name,
                                                "arguments": json.dumps(call.args),
                                            },
                                        }
                                    ],
                                }
                            )
                            messages.append(
                                {
                                    "role": "tool",
                                    "tool_call_id": call.id,
                                    "content": json.dumps(result),
                                }
                            )
                        else:
                            messages.append(
                                {
                                    "role": "assistant",
                                    "content": "",
                                    "tool_calls": [
                                        {"function": {"name": call.name, "arguments": call.args}}
                                    ],
                                }
                            )
                            messages.append(
                                {
                                    "role": "tool",
                                    "tool_name": call.name,
                                    "content": json.dumps(result),
                                }
                            )

                    message.tool_invocations = tool_invocations
                    db.commit()

            if not saw_tool_calls:
                break

        message.status = "completed"
        message.content = accumulated_text
        message.tool_invocations = tool_invocations
        db.commit()

        yield _event(
            {
                "type": "done",
                "message": {
                    "id": message.id,
                    "role": message.role,
                    "content": message.content,
                    "status": message.status,
                    "citations": citations_from_tool_invocations(tool_invocations),
                },
            }
        )

    except BaseException as exc:
        db.rollback()
        message = db.get(Message, message_id)
        message.status = "failed"
        message.content = accumulated_text or message.content
        message.tool_invocations = tool_invocations or message.tool_invocations
        message.error = "Interrupted" if isinstance(exc, GeneratorExit) else str(exc)
        db.commit()
        if not isinstance(exc, GeneratorExit):
            yield _event({"type": "error", "message": str(exc)})
        else:
            raise
    finally:
        db.close()


def sweep_interrupted_messages() -> None:
    """Mirrors app.eval.runner.sweep_interrupted_runs(). Sweeps BOTH 'pending'
    and 'streaming' - a crash between placeholder-insert and the first
    provider byte orphans a 'pending' row just as much as one stuck
    'streaming' - a deliberate widening beyond sweep_interrupted_runs()'s
    single-status sweep, since ResultCollection has no equivalent pre-start
    gap. Called once on app startup, never mid-request."""
    db = SessionLocal()
    try:
        db.query(Message).filter(Message.status.in_(("pending", "streaming"))).update(
            {"status": "failed", "error": "Interrupted by server restart"},
            synchronize_session=False,
        )
        db.commit()
    finally:
        db.close()
