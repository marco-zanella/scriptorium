"""Built-in search configuration presets — a code-defined registry (like
LanguagePack), not DB rows: these are global, not owned by any particular user.

Each preset has the exact same shape as a search request's weights: a
"weights" dict (main content) and a "variant_weights" dict (critical-apparatus
variants), both keyed by text/shingle/trigram/language/semantic — see
app/search/query.py's DEFAULT_WEIGHTS/DEFAULT_VARIANT_WEIGHTS."""

PRESETS: dict[str, dict[str, dict[str, float]]] = {
    "text reuse": {
        "weights": {"text": 0.6, "shingle": 0.2, "trigram": 0.2, "language": 0.0, "semantic": 0.0},
        "variant_weights": {
            "text": 0.3,
            "shingle": 0.1,
            "trigram": 0.1,
            "language": 0.0,
            "semantic": 0.0,
        },
    },
    "language": {
        "weights": {"text": 0.2, "shingle": 0.0, "trigram": 0.1, "language": 0.7, "semantic": 0.0},
        "variant_weights": {
            "text": 0.1,
            "shingle": 0.0,
            "trigram": 0.05,
            "language": 0.35,
            "semantic": 0.0,
        },
    },
    "semantic": {
        "weights": {"text": 0.0, "shingle": 0.0, "trigram": 0.0, "language": 0.0, "semantic": 1.0},
        "variant_weights": {
            "text": 0.0,
            "shingle": 0.0,
            "trigram": 0.0,
            "language": 0.0,
            "semantic": 0.5,
        },
    },
    "hybrid": {
        "weights": {"text": 0.2, "shingle": 0.0, "trigram": 0.1, "language": 0.7, "semantic": 1.0},
        "variant_weights": {
            "text": 0.1,
            "shingle": 0.0,
            "trigram": 0.05,
            "language": 0.35,
            "semantic": 0.5,
        },
    },
}

DEFAULT_PRESET = "hybrid"
