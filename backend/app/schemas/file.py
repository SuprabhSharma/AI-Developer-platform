from pydantic import BaseModel, Field


class FileNode(BaseModel):
    path: str
    file_type: str  # "FILE" | "DIRECTORY"
    size_bytes: int = 0


class FileTreeResponse(BaseModel):
    items: list[FileNode]


class FileContentResponse(BaseModel):
    path: str
    content: str
    size_bytes: int


class FileWriteRequest(BaseModel):
    content: str = Field(max_length=2_000_000)
