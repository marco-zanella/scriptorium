def citations_from_hits(hits: list[dict]) -> list[dict]:
    """Dedups by id, preserving first-seen order (highest-scored occurrence,
    since hits arrive rank-ordered)."""
    seen: set[str] = set()
    citations = []
    for hit in hits:
        if hit["id"] in seen:
            continue
        seen.add(hit["id"])
        citations.append(
            {
                "id": hit["id"],
                "book": hit.get("book"),
                "chapter": hit.get("chapter"),
                "verse": hit.get("verse"),
                "source": hit.get("source"),
                "content": hit.get("content"),
            }
        )
    return citations


def citations_from_tool_invocations(tool_invocations: list[dict] | None) -> list[dict]:
    """Derives the citation list shown to the user from stored tool_invocations
    at read time - never stored as its own column, matching app/eval/'s
    "no precomputed columns" convention. Shared by loop.py (the live "done"
    event) and app/api/rag.py's MessageOut (a page reload / GET .../messages)
    so both compute the exact same thing from the exact same source."""
    hits = [
        hit
        for invocation in (tool_invocations or [])
        for hit in invocation["result"].get("hits", [])
    ]
    return citations_from_hits(hits)
