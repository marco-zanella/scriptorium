from app.registry.analyzers import (
    icu_analysis_settings,
    language_aware_analysis_settings,
    merge_analysis_settings,
)
from app.registry.language_pack import EmbeddingSpec, LanguagePack

LANGUAGE_PACK = LanguagePack(
    iso_code="eng",
    display_name="English",
    script="Latin",
    directionality="ltr",
    analyzer_settings=merge_analysis_settings(
        icu_analysis_settings(), language_aware_analysis_settings("english")
    ),
    embedding_spec=EmbeddingSpec(
        model_id="BAAI/bge-base-en-v1.5",
        revision="main",
        dimension=768,
        query_prefix="Represent this sentence for searching relevant passages: ",
    ),
)
