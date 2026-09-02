import enum
import uuid
from datetime import datetime

from sqlalchemy import DateTime, Enum, Float, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin, UUIDPKMixin


class JobType(str, enum.Enum):
    REPOSITORY_INDEX = "REPOSITORY_INDEX"
    EMBEDDING_GENERATION = "EMBEDDING_GENERATION"
    TEST_EXECUTION = "TEST_EXECUTION"
    AI_TASK = "AI_TASK"


class JobStatus(str, enum.Enum):
    PENDING = "PENDING"
    RUNNING = "RUNNING"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"
    CANCELLED = "CANCELLED"


class Job(Base, UUIDPKMixin, TimestampMixin):
    """
    Generic background job record. Celery (or another queue) owns actual execution;
    this table is the durable status/progress record the API polls via GET /jobs/{id}.
    """
    __tablename__ = "jobs"

    project_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), nullable=True, index=True)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)

    type: Mapped[JobType] = mapped_column(Enum(JobType), nullable=False)
    status: Mapped[JobStatus] = mapped_column(Enum(JobStatus), default=JobStatus.PENDING, nullable=False)
    progress: Mapped[float] = mapped_column(Float, default=0.0)  # 0.0 - 1.0
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
