from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_user
from app.db.session import get_db
from app.models.usage import AIRequest
from app.models.user import User

router = APIRouter(prefix="/usage", tags=["usage"])


@router.get("")
async def get_usage(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(AIRequest).where(AIRequest.user_id == user.id).order_by(AIRequest.created_at.desc()).limit(50))
    rows = result.scalars().all()
    total_cost = sum(r.estimated_cost_usd or 0 for r in rows)
    return {
        "recent_requests": len(rows),
        "estimated_cost_usd": round(total_cost, 4),
        "requests": [
            {
                "id": str(r.id),
                "provider": r.provider,
                "model": r.model,
                "status": r.status.value,
                "input_tokens": r.input_tokens,
                "output_tokens": r.output_tokens,
                "latency_ms": r.latency_ms,
                "created_at": r.created_at.isoformat(),
            }
            for r in rows
        ],
    }
