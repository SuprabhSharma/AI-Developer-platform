"""Shared Redis client and atomic sliding-window AI limiter."""
import time
import uuid
from collections.abc import AsyncIterator

import redis.asyncio as aioredis
from fastapi import HTTPException, Request, status
from redis.asyncio import Redis
from redis.exceptions import RedisError

from app.core.config import settings
from app.core.logging import get_logger

logger = get_logger(__name__)

_RATE_LIMIT_SCRIPT = """
local now = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
local member = ARGV[4]

for _, key in ipairs(KEYS) do
  redis.call('ZREMRANGEBYSCORE', key, 0, now - window)
  if tonumber(redis.call('ZCARD', key)) >= limit then
    return 0
  end
end

for _, key in ipairs(KEYS) do
  redis.call('ZADD', key, now, member)
  redis.call('EXPIRE', key, math.ceil(window / 1000))
end
return 1
"""


def create_redis_client() -> Redis:
    return aioredis.from_url(
        settings.REDIS_URL,
        decode_responses=True,
        socket_connect_timeout=0.25,
        socket_timeout=0.5,
        health_check_interval=30,
    )


async def get_redis(request: Request) -> AsyncIterator[Redis]:
    client = getattr(request.app.state, "redis", None)
    owned = client is None
    client = client or create_redis_client()
    try:
        yield client
    finally:
        if owned:
            await client.aclose()


async def enforce_ai_rate_limit(redis: Redis, user_id: uuid.UUID, project_id: uuid.UUID) -> None:
    """Reserve one request in both windows atomically.

    Redis errors fail open so an infrastructure outage does not turn the AI
    endpoint into a total outage; production deployments should alert on the
    logged error and keep Redis highly available.
    """
    now_ms = int(time.time() * 1000)
    keys = [f"ai:rate:user:{user_id}", f"ai:rate:project:{project_id}"]
    try:
        allowed = await redis.eval(
            _RATE_LIMIT_SCRIPT,
            len(keys),
            *keys,
            now_ms,
            60_000,
            settings.RATE_LIMIT_AI_PER_MINUTE,
            f"{now_ms}:{uuid.uuid4().hex}",
        )
    except RedisError:
        logger.exception("Redis AI rate limiter unavailable; allowing request")
        return

    if int(allowed) != 1:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"AI rate limit exceeded: at most {settings.RATE_LIMIT_AI_PER_MINUTE} requests per minute per user and project.",
            headers={"Retry-After": "60"},
        )
