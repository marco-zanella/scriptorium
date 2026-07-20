import json
from collections.abc import Iterator
from dataclasses import dataclass, field
from functools import lru_cache
from typing import Literal, Protocol

import ollama
from openai import OpenAI

from app.core.config import settings


@dataclass
class NormalizedCall:
    id: str
    name: str
    args: dict
    # Set when the provider's own tool-call arguments couldn't be parsed - loop.py
    # must feed this back as a tool error result without ever executing the call.
    error: str | None = None


@dataclass
class NormalizedEvent:
    type: Literal["token", "tool_calls", "finish"]
    text: str | None = None
    calls: list[NormalizedCall] = field(default_factory=list)
    finish_reason: str | None = None


class LLMProvider(Protocol):
    def stream_chat(
        self, messages: list[dict], tools: list[dict] | None
    ) -> Iterator[NormalizedEvent]: ...


class UnknownProviderError(Exception):
    pass


class OpenRouterProvider:
    """openai SDK pointed at OpenRouter. OpenAI streams tool-call *arguments* as
    string fragments keyed by index across multiple chunks - buffered here until
    the terminal chunk's finish_reason == "tool_calls", then parsed."""

    def __init__(self) -> None:
        self._client = OpenAI(
            api_key=settings.openrouter_api_key, base_url=settings.openrouter_base_url
        )

    def stream_chat(
        self, messages: list[dict], tools: list[dict] | None
    ) -> Iterator[NormalizedEvent]:
        kwargs: dict = {
            "model": settings.llm_model,
            "messages": messages,
            "stream": True,
            "temperature": settings.llm_temperature,
            "max_tokens": settings.llm_max_tokens,
        }
        if tools:
            kwargs["tools"] = tools

        pending: dict[int, dict] = {}
        for chunk in self._client.chat.completions.create(**kwargs):
            choice = chunk.choices[0]
            delta = choice.delta

            if delta.content:
                yield NormalizedEvent(type="token", text=delta.content)

            for tc in delta.tool_calls or []:
                slot = pending.setdefault(tc.index, {"id": None, "name": None, "arguments": ""})
                if tc.id:
                    slot["id"] = tc.id
                if tc.function and tc.function.name:
                    slot["name"] = tc.function.name
                if tc.function and tc.function.arguments:
                    slot["arguments"] += tc.function.arguments

            if choice.finish_reason == "tool_calls":
                calls = []
                for index, slot in pending.items():
                    try:
                        args = json.loads(slot["arguments"]) if slot["arguments"] else {}
                        call_error = None
                    except json.JSONDecodeError as exc:
                        args, call_error = {}, f"malformed tool arguments: {exc}"
                    calls.append(
                        NormalizedCall(
                            id=slot["id"] or f"call_{index}",
                            name=slot["name"] or "",
                            args=args,
                            error=call_error,
                        )
                    )
                yield NormalizedEvent(type="tool_calls", calls=calls)
                pending = {}
            elif choice.finish_reason:
                yield NormalizedEvent(type="finish", finish_reason=choice.finish_reason)


class OllamaProvider:
    """ollama package's native Client - NOT the OpenAI-compat endpoint, which has
    an open bug dropping tool calls under streaming (ollama/ollama#12557). Tool
    calls arrive already fully-formed (parsed dict args) - no cross-chunk
    buffering needed, unlike OpenAI."""

    def __init__(self) -> None:
        self._client = ollama.Client(host=settings.ollama_base_url)

    def stream_chat(
        self, messages: list[dict], tools: list[dict] | None
    ) -> Iterator[NormalizedEvent]:
        kwargs: dict = {
            "model": settings.llm_model,
            "messages": messages,
            "stream": True,
            "options": {
                "temperature": settings.llm_temperature,
                "num_predict": settings.llm_max_tokens,
            },
        }
        if tools:
            kwargs["tools"] = tools

        call_index = 0
        for chunk in self._client.chat(**kwargs):
            message = chunk.message
            if message.content:
                yield NormalizedEvent(type="token", text=message.content)

            if message.tool_calls:
                calls = []
                for tc in message.tool_calls:
                    calls.append(
                        NormalizedCall(
                            id=f"call_{call_index}",
                            name=tc.function.name,
                            args=dict(tc.function.arguments),
                        )
                    )
                    call_index += 1
                yield NormalizedEvent(type="tool_calls", calls=calls)
            elif chunk.done:
                yield NormalizedEvent(type="finish", finish_reason=chunk.done_reason or "stop")


@lru_cache
def get_provider() -> LLMProvider:
    if settings.llm_provider == "openrouter":
        return OpenRouterProvider()
    if settings.llm_provider == "ollama":
        return OllamaProvider()
    raise UnknownProviderError(f"Unknown llm_provider: {settings.llm_provider}")
