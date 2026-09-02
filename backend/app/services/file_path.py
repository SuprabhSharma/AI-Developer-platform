from pathlib import PurePosixPath
from fastapi import HTTPException, status


def normalise_path(path: str) -> str:
    candidate = path.strip().replace("\\", "/")
    parts = [p for p in candidate.split("/") if p]
    if (
        not candidate
        or len(candidate) > 2048
        or candidate.startswith("/")
        or "\x00" in candidate
        or any(part in {".", ".."} for part in parts)
        or PurePosixPath(candidate).is_absolute()
        or len(parts) == 0
    ):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Path must stay inside the project workspace")
    return "/".join(parts)


def get_parent_paths(path: str) -> list[str]:
    """Returns all ancestor directory paths in order from root downwards."""
    parts = path.split("/")
    return ["/".join(parts[:i]) for i in range(1, len(parts))]


def validate_move_target(old_path: str, new_path: str) -> None:
    if new_path == old_path or new_path.startswith(f"{old_path}/"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Cannot move a folder into itself or one of its descendants")
