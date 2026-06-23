from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # Default to SQLite so the app works with zero external setup
    DATABASE_URL: str = "sqlite:///./evalforge.db"
    GEMINI_API_KEY: str = ""
    OPENAI_API_KEY: str = ""
    ANTHROPIC_API_KEY: str = ""
    OPENROUTER_API_KEY: str = ""
    GROQ_API_KEY: str = ""
    GITHUB_TOKEN: str = ""
    DEEPSEEK_API_KEY: str = ""
    MISTRAL_API_KEY: str = ""
    CUSTOM_MODELS: str = ""

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"


def get_settings():
    return Settings()

settings = get_settings()