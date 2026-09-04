"""Manages one Jupyter IPython kernel per project for .ipynb cell execution."""
import asyncio
import logging
import os
import sys
import time
from typing import Any, AsyncGenerator
from app.core.config import settings

logger = logging.getLogger(__name__)
_kernels: dict[str, dict] = {}  # project_id → {km, kc, last_used}
_lock = asyncio.Lock()


def resolve_workspace_path(workspace_id: str) -> str:
    """Resolve the directory path for the given workspace, supporting Docker and native host environments."""
    from app.services.sandbox_service import is_docker_available
    if is_docker_available() and settings.WORKSPACE_ROOT_CONTAINER.strip():
        path = os.path.abspath(os.path.join(settings.WORKSPACE_ROOT_CONTAINER, "workspaces", workspace_id))
    else:
        path = os.path.abspath(os.path.join(settings.LOCAL_STORAGE_ROOT, "workspaces", workspace_id))
    os.makedirs(path, exist_ok=True)
    return path


async def get_or_start_kernel(project_id: str, workspace_path: str) -> None:
    async with _lock:
        info = _kernels.get(project_id)
        if info:
            try:
                is_alive = (
                    await info["km"].is_alive()
                    if asyncio.iscoroutinefunction(info["km"].is_alive)
                    else info["km"].is_alive()
                )
                if is_alive:
                    info["last_used"] = time.time()
                    return
            except Exception:
                pass
            try:
                await info["km"].shutdown_kernel(now=True)
            except Exception:
                pass
            _kernels.pop(project_id, None)

        os.makedirs(workspace_path, exist_ok=True)
        try:
            import jupyter_client
        except ImportError:
            raise RuntimeError("jupyter_client is not installed. Please install jupyter-client to run IPython kernels.")

        km = jupyter_client.AsyncKernelManager(kernel_name="python3")
        try:
            await km.start_kernel(cwd=workspace_path)
        except Exception as e:
            logger.warning("Default python3 kernel failed to start: %s. Attempting fallback.", e)
            km = jupyter_client.AsyncKernelManager()
            await km.start_kernel(cwd=workspace_path)

        kc = km.client()
        kc.start_channels()
        try:
            await asyncio.wait_for(kc.wait_for_ready(), timeout=30)
        except asyncio.TimeoutError:
            await km.shutdown_kernel(now=True)
            raise RuntimeError("IPython Kernel failed to start within 30 seconds")

        _kernels[project_id] = {"km": km, "kc": kc, "last_used": time.time()}
        logger.info("Started native Jupyter kernel for project %s at %s", project_id, workspace_path)


async def execute_cell(project_id: str, code: str) -> AsyncGenerator[dict[str, Any], None]:
    """
    Yields CellOutput dicts as they arrive from the kernel.
    output_type: stream | execute_result | display_data | error
    """
    info = _kernels.get(project_id)
    if not info:
        raise RuntimeError("No kernel running. Call /kernel/start first.")

    kc = info["kc"]
    info["last_used"] = time.time()
    kc.execute(code, store_history=True)

    while True:
        try:
            msg = await asyncio.wait_for(kc.get_iopub_msg(timeout=30), timeout=35)
        except asyncio.TimeoutError:
            yield {
                "output_type": "error",
                "ename": "TimeoutError",
                "evalue": "Execution timed out",
                "traceback": [],
            }
            break

        t = msg.get("msg_type")
        c = msg.get("content", {})

        if t == "stream":
            yield {"output_type": "stream", "name": c.get("name"), "text": c.get("text")}
        elif t == "execute_result":
            yield {
                "output_type": "execute_result",
                "data": c.get("data", {}),
                "metadata": c.get("metadata", {}),
                "execution_count": c.get("execution_count"),
            }
        elif t == "display_data":
            yield {
                "output_type": "display_data",
                "data": c.get("data", {}),
                "metadata": c.get("metadata", {}),
            }
        elif t == "error":
            yield {
                "output_type": "error",
                "ename": c.get("ename"),
                "evalue": c.get("evalue"),
                "traceback": c.get("traceback", []),
            }
        elif t == "status" and c.get("execution_state") == "idle":
            break

    info["last_used"] = time.time()


async def shutdown_kernel(project_id: str) -> None:
    info = _kernels.pop(project_id, None)
    if info:
        try:
            info["kc"].stop_channels()
            await info["km"].shutdown_kernel(now=True)
        except Exception as e:
            logger.warning("Kernel shutdown error for %s: %s", project_id, e)


async def cleanup_idle_kernels() -> None:
    now = time.time()
    stale = [
        pid
        for pid, info in list(_kernels.items())
        if now - info.get("last_used", 0) > settings.KERNEL_IDLE_TIMEOUT_SECONDS
    ]
    for pid in stale:
        await shutdown_kernel(pid)
