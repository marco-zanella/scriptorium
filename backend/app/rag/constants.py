from app.registry import list_language_packs

# The exact "semantic" preset values seeded by migration 8cc98ca890ea - hardcoded
# here rather than fetched from that (superuser-editable) search_configuration
# row, so RAG retrieval never silently changes behavior if someone edits the
# preset through the search UI.
SEMANTIC_WEIGHTS = {"text": 0.0, "shingle": 0.0, "trigram": 0.0, "language": 0.0, "semantic": 1.0}
SEMANTIC_VARIANT_WEIGHTS = {
    "text": 0.0,
    "shingle": 0.0,
    "trigram": 0.0,
    "language": 0.0,
    "semantic": 0.5,
}

# How many hits execute_search_scriptorium asks for per tool call - a token-cost
# tradeoff (each hit becomes tool-result content fed back to the model), not a
# user-facing page size.
RAG_SEARCH_PAGE_SIZE = 8


def _language_lines() -> str:
    return "\n".join(f"- {pack.iso_code}: {pack.display_name}" for pack in list_language_packs())


def build_system_prompt() -> str:
    """Rebuilt per call (not a module-level constant) so newly-registered
    languages show up without a restart-order dependency - list_language_packs()
    already caches its own discovery, so this is cheap."""
    return f"""You are a knowledgeable assistant helping users study a corpus of biblical texts.

You have a tool, search_scriptorium, that searches the corpus. It is scoped to
one language per call - the corpus currently covers:
{_language_lines()}

Use the tool whenever answering requires checking the actual text - call it as
many times as you need (e.g. once per language, or with a refined query if the
first attempt didn't surface what you needed). Don't call it for questions that
don't need the corpus (greetings, clarifying questions, follow-ups you can
already answer from the conversation so far).

When you answer from retrieved passages, cite them by book/chapter/verse and
source (e.g. "Genesis 1:1 (KJV)"). Stay faithful to the retrieved text; if the
retrieved passages don't fully answer the question, say so rather than
guessing beyond them.
"""
