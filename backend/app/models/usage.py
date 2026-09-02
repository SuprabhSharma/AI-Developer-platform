import enum
import uuid

from sqlalchemy import Enum, Float, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin, UUIDPKMixin


class AIRequestStatus(str, enum.Enum):
    SUCCESS = "SUCCESS"
    FAILED = "FAILED"


class AIRequest(Base, UUIDPKMixin, TimestampMixin):
    """
    One row per AI provider call. This is the foundation for usage dashboards,
    cost tracking, and per-user/per-project limits (Phase 8).

    Token/cost fields are nullable because not every provider returns identical
    accounting info (see app/ai/provider.py AIResponse.usage).
    """
    __tablename__ = "ai_requests"

    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    project_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("projects.id", ondelete="SET NULL"), nullable=True, index=True)

    provider: Mapped[str] = mapped_column(String(64), nullable=False)
    model: Mapped[str] = mapped_column(String(128), nullable=False)

    input_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    output_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    latency_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    estimated_cost_usd: Mapped[float | None] = mapped_column(Float, nullable=True)

    status: Mapped[AIRequestStatus] = mapped_column(Enum(AIRequestStatus), nullable=False)
    error_message: Mapped[str | None] = mapped_column(String(2048), nullable=True)
