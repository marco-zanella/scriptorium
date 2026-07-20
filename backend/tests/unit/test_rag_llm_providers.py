from types import SimpleNamespace

import pytest

from app.core.config import settings
from app.rag.llm import OllamaProvider, OpenRouterProvider


@pytest.fixture(autouse=True)
def _dummy_openrouter_key(monkeypatch):
    """OpenRouterProvider() constructs a real openai.OpenAI client - recent
    SDK versions raise at construction time if no credential is configured at
    all. Local dev's own .env leaves openrouter_api_key blank (ollama is the
    active provider there) - these tests never make a real request, but still
    need *some* non-empty value for the client to construct."""
    monkeypatch.setattr(settings, "openrouter_api_key", "test-key")


def _chunk(content=None, tool_calls=None, finish_reason=None):
    delta = SimpleNamespace(content=content, tool_calls=tool_calls)
    choice = SimpleNamespace(delta=delta, finish_reason=finish_reason)
    return SimpleNamespace(choices=[choice])


def _tool_call_delta(index, id=None, name=None, arguments=None):
    function = SimpleNamespace(name=name, arguments=arguments)
    return SimpleNamespace(index=index, id=id, function=function)


def test_openrouter_token_and_finish_events(monkeypatch) -> None:
    provider = OpenRouterProvider()
    chunks = [_chunk(content="hel"), _chunk(content="lo"), _chunk(finish_reason="stop")]
    monkeypatch.setattr(provider._client.chat.completions, "create", lambda **kw: iter(chunks))

    events = list(provider.stream_chat([], tools=None))
    assert [e.type for e in events] == ["token", "token", "finish"]
    assert events[0].text == "hel"
    assert events[1].text == "lo"
    assert events[2].finish_reason == "stop"


def test_openrouter_buffers_fragmented_tool_call_arguments(monkeypatch) -> None:
    """OpenAI streams tool-call arguments as string fragments keyed by index
    across multiple chunks - only the terminal finish_reason=="tool_calls"
    chunk should produce a normalized event, with the fragments joined and
    parsed."""
    provider = OpenRouterProvider()
    chunks = [
        _chunk(
            tool_calls=[
                _tool_call_delta(0, id="call_abc", name="search_scriptorium", arguments='{"que')
            ]
        ),
        _chunk(tool_calls=[_tool_call_delta(0, arguments='ry": "x", "lang')]),
        _chunk(tool_calls=[_tool_call_delta(0, arguments='uage": "eng"}')]),
        _chunk(finish_reason="tool_calls"),
    ]
    monkeypatch.setattr(provider._client.chat.completions, "create", lambda **kw: iter(chunks))

    events = list(provider.stream_chat([{"role": "user", "content": "hi"}], tools=None))
    assert len(events) == 1
    assert events[0].type == "tool_calls"
    call = events[0].calls[0]
    assert call.id == "call_abc"
    assert call.name == "search_scriptorium"
    assert call.args == {"query": "x", "language": "eng"}
    assert call.error is None


def test_openrouter_malformed_tool_arguments_become_call_error(monkeypatch) -> None:
    provider = OpenRouterProvider()
    chunks = [
        _chunk(
            tool_calls=[
                _tool_call_delta(0, id="call_x", name="search_scriptorium", arguments="not json")
            ]
        ),
        _chunk(finish_reason="tool_calls"),
    ]
    monkeypatch.setattr(provider._client.chat.completions, "create", lambda **kw: iter(chunks))

    events = list(provider.stream_chat([], tools=None))
    call = events[0].calls[0]
    assert call.error is not None
    assert call.args == {}


def _ollama_chunk(content=None, tool_calls=None, done=False, done_reason=None):
    message = SimpleNamespace(content=content, tool_calls=tool_calls)
    return SimpleNamespace(message=message, done=done, done_reason=done_reason)


def _ollama_tool_call(name, arguments):
    return SimpleNamespace(function=SimpleNamespace(name=name, arguments=arguments))


def test_ollama_tool_calls_arrive_already_complete_no_buffering(monkeypatch) -> None:
    provider = OllamaProvider()
    chunks = [
        _ollama_chunk(
            tool_calls=[_ollama_tool_call("search_scriptorium", {"query": "x", "language": "eng"})],
            done=True,
            done_reason="stop",
        )
    ]
    monkeypatch.setattr(provider._client, "chat", lambda **kw: iter(chunks))

    events = list(provider.stream_chat([], tools=None))
    assert len(events) == 1
    assert events[0].type == "tool_calls"
    assert events[0].calls[0].args == {"query": "x", "language": "eng"}


def test_ollama_token_and_finish_events(monkeypatch) -> None:
    provider = OllamaProvider()
    chunks = [
        _ollama_chunk(content="hi"),
        _ollama_chunk(content="", done=True, done_reason="stop"),
    ]
    monkeypatch.setattr(provider._client, "chat", lambda **kw: iter(chunks))

    events = list(provider.stream_chat([], tools=None))
    assert events[0].type == "token"
    assert events[0].text == "hi"
    assert events[1].type == "finish"
    assert events[1].finish_reason == "stop"
