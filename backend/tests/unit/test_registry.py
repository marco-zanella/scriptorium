import pytest

from app.registry import UnknownLanguageError, get_language_pack, list_language_packs

EXPECTED = {
    "grc": ("Ancient Greek", "Greek", "ltr"),
    "lat": ("Latin", "Latin", "ltr"),
    "eng": ("English", "Latin", "ltr"),
    "ita": ("Italian", "Latin", "ltr"),
    "arb": ("Arabic", "Arabic", "rtl"),
}


def test_discovers_all_five_language_packs() -> None:
    packs = {pack.iso_code: pack for pack in list_language_packs()}
    assert set(packs) == set(EXPECTED)


@pytest.mark.parametrize("iso_code", list(EXPECTED))
def test_language_pack_metadata(iso_code: str) -> None:
    pack = get_language_pack(iso_code)
    display_name, script, directionality = EXPECTED[iso_code]
    assert pack.display_name == display_name
    assert pack.script == script
    assert pack.directionality == directionality
    assert pack.embedding_spec is None


def test_unknown_language_raises() -> None:
    with pytest.raises(UnknownLanguageError):
        get_language_pack("xxx")
