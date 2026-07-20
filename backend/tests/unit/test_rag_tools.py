from app.rag import tools as tools_module
from app.search.service import SearchResult


class _FakeClient:
    """execute_search_scriptorium never actually touches this once search()/
    get_document() are monkeypatched - it just needs to be passable."""


def test_unknown_language_returns_error_not_raise() -> None:
    result = tools_module.execute_search_scriptorium(
        _FakeClient(), query="x", language="xx", books=None, sources=None
    )
    assert result == {"error": "Unknown language: xx"}


def test_search_exception_returns_error_not_raise(monkeypatch) -> None:
    def broken_search(*args, **kwargs):
        raise RuntimeError("opensearch unreachable")

    monkeypatch.setattr("app.rag.tools.search", broken_search)

    result = tools_module.execute_search_scriptorium(
        _FakeClient(), query="x", language="eng", books=None, sources=None
    )
    assert result == {"error": "opensearch unreachable"}


def _hit(book="genesis", chapter="1", verse="1", source="kjv", id_=None) -> dict:
    return {
        "id": id_ or f"{source}:{book}:{chapter}:{verse}",
        "type": "verse",
        "book": book,
        "chapter": chapter,
        "verse": verse,
        "source": source,
        "content": "...",
        "variant": [],
        "score": 1.0,
    }


def test_hits_get_stitched_adjacent_context(monkeypatch) -> None:
    def fake_search(*args, **kwargs):
        return SearchResult(took_ms=1, count=1, page=1, page_size=8, results=[_hit()])

    def fake_get_document(client, language_pack, doc_id):
        if doc_id == "kjv:genesis:1:2":
            return _hit(verse="2")
        return None

    monkeypatch.setattr("app.rag.tools.search", fake_search)
    monkeypatch.setattr("app.rag.tools.get_document", fake_get_document)

    result = tools_module.execute_search_scriptorium(_FakeClient(), "q", "eng", None, None)
    hit = result["hits"][0]
    assert [c["id"] for c in hit["context"]] == ["kjv:genesis:1:2"]


def test_stitch_adjacent_skips_non_integer_verse(monkeypatch) -> None:
    calls: list[str] = []

    def fake_get_document(client, language_pack, doc_id):
        calls.append(doc_id)
        return None

    monkeypatch.setattr("app.rag.tools.get_document", fake_get_document)

    context = tools_module._stitch_adjacent(
        _FakeClient(), object(), _hit(chapter="119", verse="1a", book="psalms")
    )
    assert context == []
    assert calls == []


def test_books_as_json_encoded_string_is_coerced_to_a_list(monkeypatch) -> None:
    """Observed live against llama3.2:3b via Ollama: the model returned
    books='["genesis"]' (a JSON-encoded string) instead of a native array."""
    captured = {}

    def fake_search(*args, books=None, sources=None, **kwargs):
        captured["books"] = books
        captured["sources"] = sources
        return SearchResult(took_ms=1, count=0, page=1, page_size=8, results=[])

    monkeypatch.setattr("app.rag.tools.search", fake_search)

    tools_module.execute_search_scriptorium(
        _FakeClient(), "q", "eng", books='["genesis"]', sources='["kjv", "rahlfs"]'
    )

    assert captured["books"] == ["genesis"]
    assert captured["sources"] == ["kjv", "rahlfs"]


def test_filter_values_are_lowercased(monkeypatch) -> None:
    """Observed live: llama3.2:3b returned sources=["KJV"] even though the
    corpus' own source field values are always lowercase - the terms filter
    is an exact match, so the mismatch silently returned zero hits."""
    captured = {}

    def fake_search(*args, books=None, sources=None, **kwargs):
        captured["books"] = books
        captured["sources"] = sources
        return SearchResult(took_ms=1, count=0, page=1, page_size=8, results=[])

    monkeypatch.setattr("app.rag.tools.search", fake_search)

    tools_module.execute_search_scriptorium(
        _FakeClient(), "q", "eng", books=["Genesis"], sources=["KJV"]
    )

    assert captured["books"] == ["genesis"]
    assert captured["sources"] == ["kjv"]


def test_unparseable_books_string_coerces_to_none(monkeypatch) -> None:
    captured = {}

    def fake_search(*args, books=None, sources=None, **kwargs):
        captured["books"] = books
        return SearchResult(took_ms=1, count=0, page=1, page_size=8, results=[])

    monkeypatch.setattr("app.rag.tools.search", fake_search)

    tools_module.execute_search_scriptorium(
        _FakeClient(), "q", "eng", books="not json", sources=None
    )

    assert captured["books"] is None


def test_dedupe_key_ignores_argument_order() -> None:
    key_a = tools_module.dedupe_key("search_scriptorium", {"query": "x", "language": "eng"})
    key_b = tools_module.dedupe_key("search_scriptorium", {"language": "eng", "query": "x"})
    assert key_a == key_b
