"""
Async database engine and session factory.
All DB access in the app goes through `get_db` (FastAPI dependency) or `AsyncSessionLocal`
(for workers/scripts) — nothing should import `create_async_engine` elsewhere.
"""
from collections.abc import AsyncGenerator

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.config import settings

_engine_kwargs = {"echo": False, "pool_pre_ping": True}

# SQLite's async driver uses NullPool and doesn't accept pool_size/max_overflow —
# those are Postgres-specific connection pool tuning knobs.
if not settings.DATABASE_URL.startswith("sqlite"):
    _engine_kwargs["pool_size"] = 10
    _engine_kwargs["max_overflow"] = 20

engine = create_async_engine(settings.DATABASE_URL, **_engine_kwargs)

AsyncSessionLocal = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autoflush=False,
)


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async with AsyncSessionLocal() as session:
        try:
            yield session
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()