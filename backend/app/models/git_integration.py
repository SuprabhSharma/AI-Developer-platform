import uuid

from sqlalchemy import ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin, UUIDPKMixin


class GitIntegration(Base, UUIDPKMixin, TimestampMixin):
    """
    Stores OAuth connection metadata for a user's GitHub (or future GitLab) account.
    Tokens should be encrypted at rest in production (KMS/Secrets Manager) — the
    column is a placeholder for that ciphertext, never a plaintext token in prod.
    """
    __tablename__ = "git_integrations"

    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    provider: Mapped[str] = mapped_column(String(32), default="GITHUB")
    external_account_id: Mapped[str] = mapped_column(String(255), nullable=False)
    external_username: Mapped[str | None] = mapped_column(String(255), nullable=True)
    encrypted_access_token: Mapped[str | None] = mapped_column(String(2048), nullable=True)
