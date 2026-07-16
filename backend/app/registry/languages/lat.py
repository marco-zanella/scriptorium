from app.registry.analyzers import icu_analysis_settings
from app.registry.language_pack import EmbeddingSpec, LanguagePack

LANGUAGE_PACK = LanguagePack(
    iso_code="lat",
    display_name="Latin",
    script="Latin",
    directionality="ltr",
    analyzer_settings=icu_analysis_settings(),
    embedding_spec=EmbeddingSpec(
        model_id="itserr/LaBERTa-W_VULG-S_VL-Synt",
        revision="main",
        dimension=768,
        pooling="mean_skip_first",
    ),
)
