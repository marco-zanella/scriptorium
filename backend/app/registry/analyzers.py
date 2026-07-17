_SHARED_FILTERS = {
    "trigrams": {"type": "ngram", "min_gram": 3, "max_gram": 3},
    "shingles": {
        "type": "shingle",
        "min_shingle_size": 2,
        "max_shingle_size": 3,
        "output_unigrams": False,
    },
}


def icu_analysis_settings() -> dict:
    """Language-Agnostic tier (text/shingle/trigram) — used uniformly for all 5
    languages. Purely orthographic: ICU normalize/tokenize/fold + lowercase, no
    stemming or stopword removal anywhere in this tier (a shared exact phrase is
    itself a text-reuse signal — stripping stopwords would break shingle/trigram
    matching). Requires the analysis-icu plugin (see opensearch/Dockerfile)."""
    return {
        "index": {"max_ngram_diff": 64},
        "analysis": {
            "filter": _SHARED_FILTERS,
            "analyzer": {
                "text": {
                    "type": "custom",
                    "char_filter": ["icu_normalizer"],
                    "tokenizer": "icu_tokenizer",
                    "filter": ["icu_folding", "lowercase"],
                },
                "shingle": {
                    "type": "custom",
                    "char_filter": ["icu_normalizer"],
                    "tokenizer": "icu_tokenizer",
                    "filter": ["icu_folding", "lowercase", "shingles"],
                },
                "trigram": {
                    "type": "custom",
                    "char_filter": ["icu_normalizer"],
                    "tokenizer": "icu_tokenizer",
                    "filter": ["icu_folding", "lowercase", "trigrams"],
                },
            },
        },
    }


# Lucene's default Italian elision article list
# (org.apache.lucene.analysis.it.ItalianAnalyzer.DEFAULT_ARTICLES).
_ITALIAN_ELISION_ARTICLES = [
    "c", "l", "all", "dall", "dell", "nell", "sull", "coll", "pell",
    "gl", "agl", "dagl", "degl", "negl", "sugl", "un", "m", "t", "s", "v", "d",
]  # fmt: skip


def _english_language_aware_filters() -> dict:
    return {
        "eng_possessive": {"type": "stemmer", "language": "possessive_english"},
        "eng_synonym": {"type": "synonym_graph", "synonyms": []},
        "eng_stop": {"type": "stop", "stopwords": "_english_"},
        "eng_stemmer": {"type": "stemmer", "language": "english"},
    }


def _italian_language_aware_filters() -> dict:
    return {
        "ita_elision": {
            "type": "elision",
            "articles": _ITALIAN_ELISION_ARTICLES,
            "articles_case": True,
        },
        "ita_synonym": {"type": "synonym_graph", "synonyms": []},
        "ita_stop": {"type": "stop", "stopwords": "_italian_"},
        "ita_stemmer": {"type": "stemmer", "language": "light_italian"},
    }


def _arabic_language_aware_filters() -> dict:
    return {
        "arb_synonym": {"type": "synonym_graph", "synonyms": []},
        "arb_stop": {"type": "stop", "stopwords": "_arabic_"},
        "arb_stemmer": {"type": "stemmer", "language": "arabic"},
    }


_LANGUAGE_AWARE_CHAINS = {
    # (index-time filters, search-time filters) — search-time inserts the
    # synonym_graph filter; index-time never sees it (query-time-only synonym
    # expansion: the synonym list can change without reindexing, and its scoring
    # quirk — rare synonym terms scoring disproportionately via BM25 IDF — stays
    # scoped to one query rather than permanently distorting the whole index's
    # term statistics the way index-time expansion would).
    "english": (
        _english_language_aware_filters,
        ["eng_possessive", "lowercase", "eng_stop", "eng_stemmer"],
        ["eng_possessive", "lowercase", "eng_synonym", "eng_stop", "eng_stemmer"],
    ),
    "italian": (
        _italian_language_aware_filters,
        ["ita_elision", "lowercase", "ita_stop", "ita_stemmer"],
        ["ita_elision", "lowercase", "ita_synonym", "ita_stop", "ita_stemmer"],
    ),
    "arabic": (
        _arabic_language_aware_filters,
        # Deliberately reorders Lucene's own built-in ArabicAnalyzer (which runs
        # stop before arabic_normalization) so that both stopword comparison and
        # synonym matching operate on already-normalized tokens, applied
        # consistently index- and search-side rather than only where synonyms
        # need it.
        ["lowercase", "decimal_digit", "arabic_normalization", "arb_stop", "arb_stemmer"],
        [
            "lowercase",
            "decimal_digit",
            "arabic_normalization",
            "arb_synonym",
            "arb_stop",
            "arb_stemmer",
        ],
    ),
}


def language_aware_analysis_settings(language: str) -> dict:
    """Language-Aware tier (the new `language` field) — real linguistic
    normalization: stemming, stopword removal, elision (Italian), and an
    (initially empty) synonym list, replicating each language's Lucene built-in
    analyzer plus a synonym_graph filter. Only defined for languages with a real
    Lucene analyzer (english/italian/arabic) — no equivalent exists for Ancient
    Greek/Latin, so this tier is simply absent for those two (see mapping.py).

    Needs separate index/search analyzers (`language_index`/`language_search`)
    because synonym_graph only ever belongs in the search-time chain."""
    filters_fn, index_filters, search_filters = _LANGUAGE_AWARE_CHAINS[language]
    return {
        "analysis": {
            "filter": filters_fn(),
            "analyzer": {
                "language_index": {
                    "type": "custom",
                    "tokenizer": "standard",
                    "filter": index_filters,
                },
                "language_search": {
                    "type": "custom",
                    "tokenizer": "standard",
                    "filter": search_filters,
                },
            },
        },
    }


def merge_analysis_settings(*settings: dict) -> dict:
    """Combines multiple `{"index": ..., "analysis": {"filter": ..., "analyzer": ...}}`
    blobs (e.g. the Language-Agnostic and Language-Aware tiers) into one settings
    dict for a single OpenSearch index — each tier defines its own analyzer/filter
    names, so there's nothing to reconcile beyond a plain dict union."""
    merged_index: dict = {}
    merged_filter: dict = {}
    merged_analyzer: dict = {}
    for settings_block in settings:
        merged_index.update(settings_block.get("index", {}))
        analysis = settings_block.get("analysis", {})
        merged_filter.update(analysis.get("filter", {}))
        merged_analyzer.update(analysis.get("analyzer", {}))
    return {
        "index": merged_index,
        "analysis": {"filter": merged_filter, "analyzer": merged_analyzer},
    }
