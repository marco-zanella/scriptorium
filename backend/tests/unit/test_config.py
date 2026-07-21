from app.core.config import Settings


def test_database_url_is_built_from_components() -> None:
    settings = Settings(
        _env_file=None,
        postgres_user="u",
        postgres_password="p",
        postgres_db="d",
        postgres_host="h",
        postgres_port=1234,
        jwt_secret_key="test-secret",
        opensearch_host="oh",
        opensearch_port=9200,
        api_host="ah",
        api_port=8000,
        llm_provider="ollama",
        llm_model="test-model",
        llm_max_tokens=1024,
        llm_temperature=0.3,
    )
    assert settings.database_url == "postgresql+psycopg2://u:p@h:1234/d"


def test_server_url_is_built_from_components() -> None:
    settings = Settings(
        _env_file=None,
        postgres_user="u",
        postgres_password="p",
        postgres_db="d",
        postgres_host="h",
        postgres_port=1234,
        jwt_secret_key="test-secret",
        opensearch_host="oh",
        opensearch_port=9200,
        api_host="ah",
        api_port=8000,
        llm_provider="ollama",
        llm_model="test-model",
        llm_max_tokens=1024,
        llm_temperature=0.3,
    )
    assert settings.server_url == "http://ah:8000"
