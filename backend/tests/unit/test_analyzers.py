from app.registry.analyzers import (
    icu_analysis_settings,
    language_aware_analysis_settings,
    merge_analysis_settings,
)


def test_icu_settings_have_no_stemmer_or_stopwords() -> None:
    """The Language-Agnostic tier must stay purely orthographic — no stemming,
    no stopword removal, for any language."""
    analyzers = icu_analysis_settings()["analysis"]["analyzer"]
    for name in ("text", "shingle", "trigram"):
        filters = " ".join(analyzers[name]["filter"])
        assert "stop" not in filters
        assert "stem" not in filters


def test_english_language_aware_index_analyzer_has_no_synonym_filter() -> None:
    """synonym_graph only ever belongs in the search-time analyzer — indexing a
    graph token stream isn't supported without flattening, which this design
    avoids entirely by keeping synonyms query-time-only."""
    settings = language_aware_analysis_settings("english")
    index_filters = settings["analysis"]["analyzer"]["language_index"]["filter"]
    assert "eng_synonym" not in index_filters
    assert index_filters.index("eng_stop") < index_filters.index("eng_stemmer")


def test_english_language_aware_search_analyzer_synonym_before_stop() -> None:
    """Synonyms must run before stopword removal — a stopword filter running
    first would strip words like "of" out of a multi-word synonym rule before it
    ever gets a chance to match."""
    settings = language_aware_analysis_settings("english")
    search_filters = settings["analysis"]["analyzer"]["language_search"]["filter"]
    assert search_filters.index("eng_synonym") < search_filters.index("eng_stop")
    assert settings["analysis"]["filter"]["eng_synonym"] == {
        "type": "synonym_graph",
        "synonyms": [],
    }


def test_italian_elision_runs_before_stemming_and_stop() -> None:
    settings = language_aware_analysis_settings("italian")
    index_filters = settings["analysis"]["analyzer"]["language_index"]["filter"]
    assert index_filters[0] == "ita_elision"
    assert index_filters.index("ita_stop") < index_filters.index("ita_stemmer")
    assert settings["analysis"]["filter"]["ita_stemmer"] == {
        "type": "stemmer",
        "language": "light_italian",
    }


def test_arabic_normalization_runs_before_synonym_and_stop() -> None:
    """Deliberate deviation from Lucene's own built-in ArabicAnalyzer (which runs
    stop before normalization) — both stopword comparison and synonym matching
    need to operate on already-normalized tokens."""
    settings = language_aware_analysis_settings("arabic")
    search_filters = settings["analysis"]["analyzer"]["language_search"]["filter"]
    normalization_index = search_filters.index("arabic_normalization")
    assert normalization_index < search_filters.index("arb_synonym")
    assert normalization_index < search_filters.index("arb_stop")


def test_merge_analysis_settings_combines_filters_and_analyzers_without_collision() -> None:
    merged = merge_analysis_settings(
        icu_analysis_settings(), language_aware_analysis_settings("english")
    )
    analyzers = merged["analysis"]["analyzer"]
    assert {"text", "shingle", "trigram", "language_index", "language_search"} <= set(analyzers)
    assert "eng_stop" in merged["analysis"]["filter"]
    assert "trigrams" in merged["analysis"]["filter"]
    assert merged["index"] == {"max_ngram_diff": 64}
