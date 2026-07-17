from app.search.presets import DEFAULT_PRESET, PRESETS

EXPECTED_KEYS = {"text", "shingle", "trigram", "language", "semantic"}


def test_all_four_presets_present() -> None:
    assert set(PRESETS) == {"text reuse", "language", "semantic", "hybrid"}


def test_default_preset_is_hybrid() -> None:
    assert DEFAULT_PRESET == "hybrid"
    assert DEFAULT_PRESET in PRESETS


def test_every_preset_has_weights_and_variant_weights_with_all_categories() -> None:
    for preset in PRESETS.values():
        assert set(preset) == {"weights", "variant_weights"}
        assert set(preset["weights"]) == EXPECTED_KEYS
        assert set(preset["variant_weights"]) == EXPECTED_KEYS


def test_hybrid_spreads_across_all_three_categories() -> None:
    hybrid = PRESETS["hybrid"]
    for bucket in (hybrid["weights"], hybrid["variant_weights"]):
        assert bucket["text"] > 0 or bucket["shingle"] > 0 or bucket["trigram"] > 0
        assert bucket["language"] > 0
        assert bucket["semantic"] > 0


def test_language_preset_is_language_dominant() -> None:
    language = PRESETS["language"]
    assert language["weights"]["language"] > language["weights"]["text"]
    assert language["weights"]["language"] > language["weights"]["trigram"]
    assert language["weights"]["semantic"] == 0


def test_semantic_preset_is_pure_semantic() -> None:
    semantic = PRESETS["semantic"]
    assert semantic["weights"]["semantic"] > 0
    assert semantic["weights"]["text"] == 0
    assert semantic["weights"]["language"] == 0
