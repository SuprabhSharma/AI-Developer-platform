"""Manages execution sandboxes (Docker container or Native Host PTY fallback) per project."""
import asyncio
import logging
import os
import time
from typing import Any, Optional
from app.core.config import settings
from app.services.pty_service import LocalPTYSession

logger = logging.getLogger(__name__)

# project_id → {"mode": "docker"|"local", "container_id": Optional[str], "session": Optional[LocalPTYSession], "last_used": float}
_registry: dict[str, dict[str, Any]] = {}
_docker_available: Optional[bool] = None
_last_docker_check: float = 0.0
DOCKER_CHECK_TTL = 15.0  # seconds


def is_docker_available() -> bool:
    """Check if Docker daemon and Python SDK are available and responsive."""
    global _docker_available, _last_docker_check
    now = time.time()
    if _docker_available is not None and (now - _last_docker_check < DOCKER_CHECK_TTL):
        return _docker_available

    try:
        import docker  # Dynamic import in case docker package is not installed
        client = docker.from_env(timeout=2)
        client.ping()
        _docker_available = True
        logger.info("Docker daemon is running and available.")
    except Exception as e:
        _docker_available = False
        logger.info("Docker is not available (%s); using Native Subprocess / Host PTY fallback.", e)

    _last_docker_check = now
    return _docker_available


def _client():
    import docker
    return docker.from_env()


def _name(pid: str) -> str:
    return f"forge-sandbox-{pid}"


def host_workspace_path(workspace_id: str) -> str:
    """Resolve the absolute host workspace directory."""
    return os.path.abspath(os.path.join(settings.LOCAL_STORAGE_ROOT, "workspaces", workspace_id))


async def get_or_create_sandbox(project_id: str, workspace_id: str) -> dict[str, Any]:
    """
    Get or create an execution sandbox.
    If Docker is running, returns {"mode": "docker", "container_id": id, "workspace_path": path}.
    If Docker is NOT running, returns {"mode": "local", "container_id": "local", "workspace_path": path}.
    """
    host_ws = host_workspace_path(workspace_id)
    os.makedirs(host_ws, exist_ok=True)

    if is_docker_available():
        try:
            import docker.errors
            name = _name(project_id)
            c = _client()
            try:
                container = c.containers.get(name)
                if container.status != "running":
                    container.start()
                _registry[project_id] = {
                    "mode": "docker",
                    "container_id": container.id,
                    "session": None,
                    "last_used": time.time(),
                }
                return {"mode": "docker", "container_id": container.id, "workspace_path": host_ws}
            except docker.errors.NotFound:
                pass
            except Exception as e:
                logger.warning("Error fetching existing Docker container: %s. Recreating.", e)

            container = c.containers.run(
                image=settings.SANDBOX_IMAGE,
                name=name,
                command="bash",
                stdin_open=True,
                tty=True,
                detach=True,
                working_dir="/workspace",
                volumes={host_ws: {"bind": "/workspace", "mode": "rw"}},
                mem_limit=settings.SANDBOX_MEM_LIMIT,
                cpu_period=settings.SANDBOX_CPU_PERIOD,
                cpu_quota=settings.SANDBOX_CPU_QUOTA,
                network_mode=settings.SANDBOX_NETWORK_MODE,
                remove=False,
                labels={"forge": "sandbox", "project_id": project_id},
            )
            _registry[project_id] = {
                "mode": "docker",
                "container_id": container.id,
                "session": None,
                "last_used": time.time(),
            }
            logger.info("Created Docker sandbox %s for project %s", container.id[:12], project_id)
            return {"mode": "docker", "container_id": container.id, "workspace_path": host_ws}
        except Exception as e:
            logger.warning("Failed to start Docker container: %s. Falling back to native local execution.", e)

    # Native Local Fallback
    _registry[project_id] = {
        "mode": "local",
        "container_id": "local",
        "session": _registry.get(project_id, {}).get("session"),
        "last_used": time.time(),
    }
    logger.info("Using Native Local Host PTY sandbox for project %s at %s", project_id, host_ws)
    return {"mode": "local", "container_id": "local", "workspace_path": host_ws}


def register_local_session(project_id: str, session: LocalPTYSession) -> None:
    """Associate an active LocalPTYSession with a project in the registry."""
    if project_id in _registry:
        _registry[project_id]["session"] = session
        _registry[project_id]["last_used"] = time.time()
    else:
        _registry[project_id] = {
            "mode": "local",
            "container_id": "local",
            "session": session,
            "last_used": time.time(),
        }


def get_local_session(project_id: str) -> Optional[LocalPTYSession]:
    """Retrieve an active LocalPTYSession if registered."""
    return _registry.get(project_id, {}).get("session")


async def stop_sandbox(project_id: str) -> None:
    """Stop sandbox container or local PTY session for the project."""
    info = _registry.pop(project_id, None)
    if not info:
        return

    # 1. Stop local PTY session if active
    local_session = info.get("session")
    if local_session:
        try:
            await local_session.close()
        except Exception as e:
            logger.warning("Error closing LocalPTYSession for %s: %s", project_id, e)

    # 2. Stop Docker container if active
    if info.get("mode") == "docker":
        try:
            import docker.errors
            c = _client()
            container = c.containers.get(_name(project_id))
            container.stop(timeout=5)
            container.remove(force=True)
            logger.info("Stopped Docker sandbox for %s", project_id)
        except Exception as e:
            logger.warning("Error stopping Docker sandbox for %s: %s", project_id, e)


async def cleanup_idle_sandboxes() -> None:
    """Periodically shut down idle sandboxes to free system memory."""
    now = time.time()
    stale = [
        pid
        for pid, info in list(_registry.items())
        if now - info.get("last_used", 0) > settings.SANDBOX_TIMEOUT_IDLE_SECONDS
    ]
    for pid in stale:
        await stop_sandbox(pid)


def touch_sandbox(project_id: str) -> None:
    """Mark sandbox as active to prevent idle shutdown."""
    if project_id in _registry:
        _registry[project_id]["last_used"] = time.time()
