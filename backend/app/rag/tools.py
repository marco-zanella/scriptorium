import json

from opensearchpy import OpenSearch

from app.rag.constants import RAG_SEARCH_PAGE_SIZE, SEMANTIC_VARIANT_WEIGHTS, SEMANTIC_WEIGHTS
from app.registry import LanguagePack, UnknownLanguageError, get_language_pack, list_language_packs
from app.search.service import get_document, search

TOOL_NAME = "search_scriptorium"


def build_tool_schema() -> dict:
    """Rebuilt per call (not a module-level constant), same reasoning as
    constants.build_system_prompt - newly-registered languages show up without
    a restart-order dependency."""
    return {
        "type": "function",
        "function": {
            "name": TOOL_NAME,
            "description": (
                "Search the biblical text corpus. Scoped to one language per call - "
                "call it again with a different language to cover more than one. "
                "books/sources are optional exact-match filters against the corpus' "
                "own book/source values (e.g. book='genesis', source='kjv'; case doesn't "
                "matter) - omit them unless the question specifically names a book or "
                "edition."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "Free-text search query."},
                    "language": {
                        "type": "string",
                        "enum": [pack.iso_code for pack in list_language_packs()],
                    },
                    "books": {"type": ["array", "null"], "items": {"type": "string"}},
                    "sources": {"type": ["array", "null"], "items": {"type": "string"}},
                },
                "required": ["query", "language"],
            },
        },
    }


def dedupe_key(name: str, args: dict) -> tuple:
    return (name, json.dumps(args, sort_keys=True))


def _stitch_adjacent(client: OpenSearch, language_pack: LanguagePack, hit: dict) -> list[dict]:
    """Given a hit's own source/book/chapter/verse fields (never by parsing its
    id string - that's an upstream convention, not something app code enforces),
    probes verse-1 and verse+1 via get_document(): a plain existence check
    within the same book/chapter/source, never crossing a chapter or book
    boundary. Any hit whose verse isn't a plain integer (a lettered sub-verse, a
    range, ...) is skipped silently - no context, not an error."""
    try:
        verse_num = int(hit["verse"])
    except (TypeError, ValueError):
        return []

    context = []
    for candidate_verse in (verse_num - 1, verse_num + 1):
        candidate_id = f"{hit['source']}:{hit['book']}:{hit['chapter']}:{candidate_verse}"
        doc = get_document(client, language_pack, candidate_id)
        if doc is not None:
            context.append(doc)
    return context


def _coerce_filter_list(value: object) -> list[str] | None:
    """Normalizes a books/sources tool argument against two real model quirks
    observed live (llama3.2:3b via Ollama):
    1. The argument arrives as a JSON-encoded string ('["genesis"]') instead of
       a native array - parsed here rather than costing a wasted
       call/error/retry round-trip for a recoverable formatting slip.
    2. Values get capitalized (source="KJV") even though the corpus' own
       book/source field values are always lowercase (source="kjv") - the
       book/source filter is an OpenSearch `terms` exact match, so a case
       mismatch silently returns zero hits rather than an error. Lowercasing
       here matches the ingestion convention rather than trusting every model
       to reproduce exact casing for a proper noun."""
    if value is None:
        return None
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
        except json.JSONDecodeError:
            return None
        value = parsed
    if not isinstance(value, list):
        return None
    return [item.lower() if isinstance(item, str) else item for item in value]


def execute_search_scriptorium(
    client: OpenSearch,
    query: str,
    language: str,
    books: list[str] | None,
    sources: list[str] | None,
) -> dict:
    """Never raises - any registry/OpenSearch error is caught and returned as
    {"error": str(exc)} so the calling loop can always feed *something* back to
    the model instead of crashing the request."""
    try:
        language_pack = get_language_pack(language)
    except UnknownLanguageError as exc:
        return {"error": str(exc)}

    try:
        result = search(
            client,
            language_pack,
            query,
            weights=SEMANTIC_WEIGHTS,
            variant_weights=SEMANTIC_VARIANT_WEIGHTS,
            books=_coerce_filter_list(books),
            sources=_coerce_filter_list(sources),
            page_size=RAG_SEARCH_PAGE_SIZE,
        )
    except Exception as exc:
        return {"error": str(exc)}

    hits = [
        {**hit, "context": _stitch_adjacent(client, language_pack, hit)} for hit in result.results
    ]
    return {"hits": hits}
