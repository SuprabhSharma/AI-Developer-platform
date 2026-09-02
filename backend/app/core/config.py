"""
Centralized application configuration.
All secrets/config are pulled from environment variables (.env in dev).
Never hard-code secrets anywhere else in the codebase — import `settings` instead.
"""
from functools import lru_cache
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # --- App ---
    APP_NAME: str = "AI Developer Platform"
    ENVIRONMENT: Literal["development", "staging", "production"] = "development"
    DEBUG: bool = True
    API_V1_PREFIX: str = "/api/v1"

    # --- Database ---
    DATABASE_URL: str = "postgresql+asyncpg://postgres:postgres@localhost:5432/ai_dev_platform"

    # --- Redis ---
    REDIS_URL: str = "redis://localhost:6379/0"

    # --- Auth ---
    JWT_SECRET: str = "CHANGE_ME_IN_PRODUCTION"
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 30
    REFRESH_TOKEN_EXPIRE_DAYS: int = 14

    # --- AI Provider ---
    # Swapping providers only requires changing this env var; see app/ai/factory.py
    AI_PROVIDER: Literal["mock", "gemini", "groq", "openrouter", "ollama"] = "mock"
    AI_API_KEY: str = ""
    AI_MODEL: str = "default"

    # --- GitHub Integration ---
    GITHUB_CLIENT_ID: str = ""
    GITHUB_CLIENT_SECRET: str = ""

    # --- Storage ---
    STORAGE_PROVIDER: Literal["local", "s3"] = "local"
    LOCAL_STORAGE_ROOT: str = "./storage_data"
    S3_BUCKET: str = ""
    S3_REGION: str = ""

    # --- Rate limiting (requests per minute, enforced via Redis) ---
    RATE_LIMIT_AUTH_PER_MINUTE: int = 10
    RATE_LIMIT_AI_PER_MINUTE: int = 20
    RATE_LIMIT_DEFAULT_PER_MINUTE: int = 100

    # --- CORS ---
    CORS_ORIGINS: list[str] = ["http://localhost:3000"]

    # --- File operation safety limits ---
    MAX_FILE_READ_BYTES: int = 1_000_000  # 1MB cap on a single file read


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
