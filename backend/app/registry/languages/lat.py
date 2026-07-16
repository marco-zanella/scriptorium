from app.registry.analyzers import icu_analysis_settings
from app.registry.language_pack import LanguagePack

LANGUAGE_PACK = LanguagePack(
    iso_code="lat",
    display_name="Latin",
    script="Latin",
    directionality="ltr",
    analyzer_settings=icu_analysis_settings(),
)
