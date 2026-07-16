"""Built-in search configuration presets — a code-defined registry (like
LanguagePack), not DB rows: these are global, not owned by any particular user.

Each preset has the exact same shape as a search request's weights: a
"weights" dict (main content) and a "variant_weights" dict (critical-apparatus
variants), both keyed by text/shingle/trigram/language/semantic — see
app/search/query.py's DEFAULT_WEIGHTS/DEFAULT_VARIANT_WEIGHTS."""

PRESETS: dict[str, dict[str, dict[str, float]]] = {
    "text reuse": {
        "weights": {"text": 0.0, "shingle": 0.5, "trigram": 0.5, "language": 0.0, "semantic": 0.0},
        "variant_weights": {
            "text": 0.0,
            "shingle": 0.5,
            "trigram": 0.5,
            "language": 0.0,
            "semantic": 0.0,
        },
    },
    "language": {
        "weights": {"text": 0.0, "shingle": 0.0, "trigram": 0.0, "language": 1.0, "semantic": 0.0},
        "variant_weights": {
            "text": 0.0,
            "shingle": 0.0,
            "trigram": 0.0,
            "language": 0.5,
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
        "weights": {"text": 0.1, "shingle": 0.1, "trigram": 0.1, "language": 0.5, "semantic": 0.5},
        "variant_weights": {
            "text": 0.25,
            "shingle": 0.25,
            "trigram": 0.25,
            "language": 0.25,
            "semantic": 0.25,
        },
    },
}

DEFAULT_PRESET = "hybrid"
