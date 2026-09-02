from pydantic import BaseModel, Field


class FileNode(BaseModel):
    path: str
    file_type: str  # "FILE" | "DIRECTORY"
    size_bytes: int = 0


class FileTreeResponse(BaseModel):
    items: list[FileNode]


class FileUploadResponse(BaseModel):
    items: list[FileNode]
    total: int


class FileContentResponse(BaseModel):
    path: str
    content: str
    size_bytes: int


class FileWriteRequest(BaseModel):
    content: str = Field(max_length=2_000_000)


class FolderCreateRequest(BaseModel):
    path: str = Field(min_length=1, max_length=2048)


class FileRenameRequest(BaseModel):
    new_path: str = Field(min_length=1, max_length=2048)
