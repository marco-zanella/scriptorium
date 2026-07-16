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
    """Analyzer chain for languages with no built-in OpenSearch language analyzer
    (ancient Greek, Latin) — folds polytonic/diacritic marks via ICU normalization.
    Requires the analysis-icu plugin (see opensearch/Dockerfile)."""
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


def builtin_language_analysis_settings(analyzer_name: str) -> dict:
    """Analyzer chain for languages OpenSearch ships a built-in language analyzer
    for (English, Italian, Arabic) — uses that analyzer's own stemming/stopwords."""
    return {
        "index": {"max_ngram_diff": 64},
        "analysis": {
            "filter": _SHARED_FILTERS,
            "analyzer": {
                "text": {"type": analyzer_name},
                "shingle": {
                    "type": "custom",
                    "tokenizer": "standard",
                    "filter": ["lowercase", "shingles"],
                },
                "trigram": {
                    "type": "custom",
                    "tokenizer": "standard",
                    "filter": ["lowercase", "trigrams"],
                },
            },
        },
    }
