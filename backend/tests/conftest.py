"""
Test fixtures: an in-memory SQLite async engine (schema created from the same
ORM metadata used in production Postgres) and an httpx AsyncClient bound to
the FastAPI app via ASGI transport — no real network/socket needed.
"""
import asyncio

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core.config import settings
from app.db.base import Base
from app.db.session import get_db
from app.main import app as fastapi_app
import app.models  # noqa: F401


@pytest.fixture(autouse=True)
def isolate_ai_provider(monkeypatch):
    """Keep tests offline even when a developer has configured a live provider."""
    monkeypatch.setattr(settings, "AI_PROVIDER", "mock")
    monkeypatch.setattr(settings, "AI_API_KEY", "")
    monkeypatch.setattr(settings, "AI_MODEL", "default")


@pytest_asyncio.fixture
async def db_session():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    session_factory = async_sessionmaker(engine, expire_on_commit=False)

    async def override_get_db():
        async with session_factory() as session:
            yield session

    fastapi_app.dependency_overrides[get_db] = override_get_db
    async with session_factory() as session:
        yield session
    await engine.dispose()
    fastapi_app.dependency_overrides.clear()


@pytest_asyncio.fixture
async def client(db_session):
    transport = ASGITransport(app=fastapi_app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac
