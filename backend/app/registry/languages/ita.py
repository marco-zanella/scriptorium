from app.registry.analyzers import builtin_language_analysis_settings
from app.registry.language_pack import EmbeddingSpec, LanguagePack

LANGUAGE_PACK = LanguagePack(
    iso_code="ita",
    display_name="Italian",
    script="Latin",
    directionality="ltr",
    analyzer_settings=builtin_language_analysis_settings("italian"),
    embedding_spec=EmbeddingSpec(
        model_id="nickprock/sentence-bert-base-italian-uncased",
        revision="main",
        dimension=768,
    ),
)
