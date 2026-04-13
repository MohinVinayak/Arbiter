from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    DATABASE_URL: str = "postgresql://postgres:Jabagavaeashit@005@db.muwgrchqhxctfuhdxwys.supabase.co:5432/postgres"
    GEMINI_API_KEY: str = ""
    OPENAI_API_KEY: str = ""
    ANTHROPIC_API_KEY: str = ""
    OPENROUTER_API_KEY: str = ""
    GROQ_API_KEY: str = ""
    GITHUB_TOKEN: str = ""

    class Config:
        env_file = ".env"

settings = Settings()