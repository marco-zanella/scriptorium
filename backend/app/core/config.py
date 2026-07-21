from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    postgres_user: str
    postgres_password: str
    postgres_db: str
    postgres_host: str
    postgres_port: int
    jwt_secret_key: str

    opensearch_host: str
    opensearch_port: int
    opensearch_index_prefix: str = ""

    api_host: str
    api_port: int

    llm_provider: str
    llm_model: str
    openrouter_api_key: str = ""
    openrouter_base_url: str = "https://openrouter.ai/api/v1"
    ollama_base_url: str = "http://localhost:11434"
    llm_max_tokens: int
    llm_temperature: float
    rag_max_tool_iterations: int = 5

    @property
    def database_url(self) -> str:
        return (
            f"postgresql+psycopg2://{self.postgres_user}:{self.postgres_password}"
            f"@{self.postgres_host}:{self.postgres_port}/{self.postgres_db}"
        )

    @property
    def server_url(self) -> str:
        return f"http://{self.api_host}:{self.api_port}"


settings = Settings()
