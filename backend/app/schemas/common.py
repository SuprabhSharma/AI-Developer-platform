from pydantic import BaseModel


class ErrorResponse(BaseModel):
    """Consistent error envelope returned by all API error responses."""
    error: str
    detail: str | None = None
    request_id: str | None = None


class HealthResponse(BaseModel):
    status: str
    database: str | None = None
    redis: str | None = None
