from app.registry.analyzers import builtin_language_analysis_settings
from app.registry.language_pack import LanguagePack

LANGUAGE_PACK = LanguagePack(
    iso_code="arb",
    display_name="Arabic",
    script="Arabic",
    directionality="rtl",
    analyzer_settings=builtin_language_analysis_settings("arabic"),
)
