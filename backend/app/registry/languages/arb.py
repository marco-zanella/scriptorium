from app.registry.analyzers import builtin_language_analysis_settings
from app.registry.language_pack import EmbeddingSpec, LanguagePack

LANGUAGE_PACK = LanguagePack(
    iso_code="arb",
    display_name="Arabic",
    script="Arabic",
    directionality="rtl",
    analyzer_settings=builtin_language_analysis_settings("arabic"),
    embedding_spec=EmbeddingSpec(
        model_id="omarelshehy/Arabic-Retrieval-v1.0",
        revision="main",
        dimension=768,
        query_prefix="<query>: ",
        document_prefix="<passage>: ",
    ),
)
