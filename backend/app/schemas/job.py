import uuid
from datetime import datetime

from pydantic import BaseModel


class JobRead(BaseModel):
    id: uuid.UUID
    type: str
    status: str
    progress: float
    error: str | None
    created_at: datetime
    completed_at: datetime | None

    model_config = {"from_attributes": True}
