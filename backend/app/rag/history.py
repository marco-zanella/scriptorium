import json

from app.rag.models import Conversation


def build_provider_messages(conversation: Conversation, provider_name: str) -> list[dict]:
    """Reconstructs the flat message list a provider's chat API expects from
    stored Conversation/Message rows. Only status='completed' assistant rows
    are replayed - a failed or in-flight row is shown to the *user* in the
    transcript but treated as if it never happened from the model's point of
    view (replaying a half-formed answer risks the model treating its own
    truncated fragment as already delivered).

    tool_invocations entries are always {"name", "args", "result"} triples -
    never a dangling call-without-result, since a call is only appended after
    execution completes - so every completed row's tool exchange is always
    safe to reconstruct. Each invocation becomes its own single-call
    assistant-message + single tool-result-message pair, in order - a valid
    re-serialization regardless of whether the original calls were issued
    simultaneously or across several loop iterations.
    """
    messages: list[dict] = []
    for message in conversation.messages:
        if message.role == "user":
            messages.append({"role": "user", "content": message.content})
            continue

        if message.status != "completed":
            continue

        for index, invocation in enumerate(message.tool_invocations or []):
            call_id = f"call_{message.id}_{index}"
            if provider_name == "openrouter":
                messages.append(
                    {
                        "role": "assistant",
                        "content": None,
                        "tool_calls": [
                            {
                                "id": call_id,
                                "type": "function",
                                "function": {
                                    "name": invocation["name"],
                                    "arguments": json.dumps(invocation["args"]),
                                },
                            }
                        ],
                    }
                )
                messages.append(
                    {
                        "role": "tool",
                        "tool_call_id": call_id,
                        "content": json.dumps(invocation["result"]),
                    }
                )
            else:
                messages.append(
                    {
                        "role": "assistant",
                        "content": "",
                        "tool_calls": [
                            {
                                "function": {
                                    "name": invocation["name"],
                                    "arguments": invocation["args"],
                                }
                            }
                        ],
                    }
                )
                messages.append(
                    {
                        "role": "tool",
                        "tool_name": invocation["name"],
                        "content": json.dumps(invocation["result"]),
                    }
                )

        messages.append({"role": "assistant", "content": message.content or ""})

    return messages
