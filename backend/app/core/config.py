"""
Centralized application configuration.
All secrets/config are pulled from environment variables (.env in dev).
Never hard-code secrets anywhere else in the codebase — import `settings` instead.
"""
from functools import lru_cache
from typing import Literal

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(".env", "backend/.env", "../.env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # --- App ---
    APP_NAME: str = "AI Developer Platform"
    ENVIRONMENT: Literal["development", "staging", "production"] = "development"
    DEBUG: bool = True
    API_V1_PREFIX: str = "/api/v1"

    @field_validator("DEBUG", mode="before")
    @classmethod
    def parse_debug(cls, value):
        """Accept the deployment-style ``release`` flag as debug disabled."""
        if isinstance(value, str) and value.strip().lower() == "release":
            return False
        return value

    @field_validator("AI_API_KEY", "AI_MODEL", "AI_PROVIDER", "GROQ_ENDPOINT", mode="before")
    @classmethod
    def clean_str_settings(cls, value):
        if isinstance(value, str):
            return value.strip().strip("'\"")
        return value

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
    AI_PROVIDER: str = "groq"
    AI_API_KEY: str = ""
    AI_MODEL: str = "openai/gpt-oss-120b"
    AI_AGENT_MAX_TOKENS: int = 4096
    GROQ_ENDPOINT: str = "https://api.groq.com/openai/v1/chat/completions"

    # --- Storage ---
    STORAGE_PROVIDER: str = "local"
    LOCAL_STORAGE_ROOT: str = "./storage_data"

    # --- Rate limiting (requests per minute, enforced via Redis) ---
    RATE_LIMIT_AUTH_PER_MINUTE: int = 10
    RATE_LIMIT_AI_PER_MINUTE: int = 20
    RATE_LIMIT_DEFAULT_PER_MINUTE: int = 100

    # --- CORS ---
    CORS_ORIGINS: list[str] = ["http://localhost:3000", "http://127.0.0.1:3000"]

    # --- File operation safety limits ---
    MAX_FILE_READ_BYTES: int = 1_000_000  # 1MB cap on a single file read
    MAX_FILE_UPLOAD_BYTES: int = 10_000_000  # 10MB cap per uploaded file
    MAX_BATCH_UPLOAD_FILES: int = 1_000

    # --- Execution Sandbox ---
    SANDBOX_IMAGE: str = "python:3.11-slim"
    SANDBOX_CPU_PERIOD: int = 100_000
    SANDBOX_CPU_QUOTA: int = 50_000          # 50% of 1 CPU
    SANDBOX_MEM_LIMIT: str = "256m"
    SANDBOX_TIMEOUT_IDLE_SECONDS: int = 300  # Kill container after 5min idle
    SANDBOX_NETWORK_MODE: str = "none"       # No internet in sandbox (security)
    WORKSPACE_ROOT_HOST: str = "./storage_data"
    WORKSPACE_ROOT_CONTAINER: str = "/workspaces"
    KERNEL_IDLE_TIMEOUT_SECONDS: int = 600


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
