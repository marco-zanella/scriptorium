import importlib
import pkgutil

from app.registry import languages
from app.registry.language_pack import LanguagePack


class UnknownLanguageError(Exception):
    """Raised when an ISO code doesn't match any registered LanguagePack."""


_registry: dict[str, LanguagePack] | None = None


def _discover() -> dict[str, LanguagePack]:
    packs = {}
    for module_info in pkgutil.iter_modules(languages.__path__):
        module = importlib.import_module(f"{languages.__name__}.{module_info.name}")
        pack: LanguagePack = module.LANGUAGE_PACK
        packs[pack.iso_code] = pack
    return packs


def list_language_packs() -> list[LanguagePack]:
    global _registry
    if _registry is None:
        _registry = _discover()
    return list(_registry.values())


def get_language_pack(iso_code: str) -> LanguagePack:
    global _registry
    if _registry is None:
        _registry = _discover()
    try:
        return _registry[iso_code]
    except KeyError:
        raise UnknownLanguageError(f"Unknown language: {iso_code}") from None
