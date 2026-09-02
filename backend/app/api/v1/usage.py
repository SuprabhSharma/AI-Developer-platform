from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends
from sqlalchemy import case, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_user
from app.db.session import get_db
from app.models.usage import AIRequest
from app.models.user import User

router = APIRouter(prefix="/usage", tags=["usage"])


@router.get("")
async def get_usage(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    week_start = datetime.now(timezone.utc) - timedelta(days=7)
    total_tokens = func.coalesce(AIRequest.input_tokens, 0) + func.coalesce(AIRequest.output_tokens, 0)
    summary = await db.execute(
        select(
            func.count(AIRequest.id),
            func.coalesce(func.sum(AIRequest.estimated_cost_usd), 0.0),
            func.coalesce(
                func.sum(case((AIRequest.created_at >= week_start, total_tokens), else_=0)),
                0,
            ),
        ).where(AIRequest.user_id == user.id)
    )
    total_requests, total_cost, tokens_this_week = summary.one()

    provider_rows = await db.execute(
        select(
            AIRequest.provider,
            func.count(AIRequest.id),
            func.coalesce(func.sum(total_tokens), 0),
            func.coalesce(func.sum(AIRequest.estimated_cost_usd), 0.0),
        )
        .where(AIRequest.user_id == user.id)
        .group_by(AIRequest.provider)
        .order_by(AIRequest.provider)
    )

    result = await db.execute(
        select(AIRequest)
        .where(AIRequest.user_id == user.id)
        .order_by(AIRequest.created_at.desc())
        .limit(50)
    )
    rows = result.scalars().all()
    return {
        "total_requests": int(total_requests or 0),
        "total_estimated_cost_usd": round(float(total_cost or 0), 8),
        "tokens_used_this_week": int(tokens_this_week or 0),
        # Kept for clients built against the Phase 1 response.
        "recent_requests": len(rows),
        "estimated_cost_usd": round(sum(r.estimated_cost_usd or 0 for r in rows), 4),
        "providers": [
            {
                "provider": provider,
                "requests": int(requests),
                "tokens": int(tokens or 0),
                "estimated_cost_usd": round(float(cost or 0), 8),
            }
            for provider, requests, tokens, cost in provider_rows.all()
        ],
        "requests": [
            {
                "id": str(r.id),
                "provider": r.provider,
                "model": r.model,
                "status": r.status.value,
                "input_tokens": r.input_tokens,
                "output_tokens": r.output_tokens,
                "total_tokens": (r.input_tokens or 0) + (r.output_tokens or 0),
                "latency_ms": r.latency_ms,
                "created_at": r.created_at.isoformat(),
            }
            for r in rows
        ],
    }
