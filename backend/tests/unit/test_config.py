from app.core.config import Settings


def test_database_url_is_built_from_components() -> None:
    settings = Settings(
        _env_file=None,
        postgres_user="u",
        postgres_password="p",
        postgres_db="d",
        postgres_host="h",
        postgres_port=1234,
    )
    assert settings.database_url == "postgresql+psycopg2://u:p@h:1234/d"
