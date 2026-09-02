"""Liveness/readiness endpoints. No auth required — used by Docker/orchestrators."""
from fastapi import APIRouter
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from fastapi import Depends
import redis.asyncio as aioredis

from app.core.config import settings
from app.db.session import get_db
from app.schemas.common import HealthResponse

router = APIRouter(tags=["health"])


@router.get("/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    return HealthResponse(status="ok")


@router.get("/health/db", response_model=HealthResponse)
async def health_db(db: AsyncSession = Depends(get_db)) -> HealthResponse:
    try:
        await db.execute(text("SELECT 1"))
        return HealthResponse(status="ok", database="ok")
    except Exception as e:  # noqa: BLE001
        return HealthResponse(status="degraded", database=f"error: {e}")


@router.get("/health/redis", response_model=HealthResponse)
async def health_redis() -> HealthResponse:
    try:
        client = aioredis.from_url(settings.REDIS_URL)
        await client.ping()
        await client.close()
        return HealthResponse(status="ok", redis="ok")
    except Exception as e:  # noqa: BLE001
        return HealthResponse(status="degraded", redis=f"error: {e}")
