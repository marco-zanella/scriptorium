import pytest

from app.registry import UnknownLanguageError, get_language_pack, list_language_packs

EXPECTED = {
    "grc": ("Ancient Greek", "Greek", "ltr", "bowphs/SPhilBerta"),
    "lat": ("Latin", "Latin", "ltr", "itserr/LaBERTa-W_VULG-S_VL-Synt"),
    "eng": ("English", "Latin", "ltr", "BAAI/bge-base-en-v1.5"),
    "ita": ("Italian", "Latin", "ltr", "nickprock/sentence-bert-base-italian-uncased"),
    "arb": ("Arabic", "Arabic", "rtl", "omarelshehy/Arabic-Retrieval-v1.0"),
}


def test_discovers_all_five_language_packs() -> None:
    packs = {pack.iso_code: pack for pack in list_language_packs()}
    assert set(packs) == set(EXPECTED)


@pytest.mark.parametrize("iso_code", list(EXPECTED))
def test_language_pack_metadata(iso_code: str) -> None:
    pack = get_language_pack(iso_code)
    display_name, script, directionality, model_id = EXPECTED[iso_code]
    assert pack.display_name == display_name
    assert pack.script == script
    assert pack.directionality == directionality
    assert pack.embedding_spec is not None
    assert pack.embedding_spec.model_id == model_id
    assert pack.embedding_spec.dimension == 768


def test_unknown_language_raises() -> None:
    with pytest.raises(UnknownLanguageError):
        get_language_pack("xxx")


def test_latin_uses_mean_skip_first_pooling() -> None:
    # itserr/LaBERTa-W_VULG-S_VL-Synt is a bare transformers checkpoint (no packaged
    # sentence-transformers pooling config) — its own config.json specifies
    # "pooling_strategy": "mean" over all tokens but the first.
    assert get_language_pack("lat").embedding_spec.pooling == "mean_skip_first"


def test_latin_tokenizer_comes_from_base_model() -> None:
    # itserr/LaBERTa-W_VULG-S_VL-Synt's own repo ships only weights/config wrapped
    # in a custom container — its config.json's embedding_config._name_or_path
    # points at the base model both the tokenizer and architecture come from.
    assert get_language_pack("lat").embedding_spec.base_model_id == "bowphs/LaBerta"


@pytest.mark.parametrize("iso_code", ["grc", "eng", "ita", "arb"])
def test_other_languages_use_sentence_transformers_pooling(iso_code: str) -> None:
    spec = get_language_pack(iso_code).embedding_spec
    assert spec.pooling == "sentence_transformers"
    assert spec.base_model_id is None
