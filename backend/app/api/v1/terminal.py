"""WebSocket PTY bridge: browser xterm.js ↔ Docker container bash OR Native Host PTY."""
import asyncio
import json
import logging
from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect
from app.core.security import decode_access_token
from app.services.sandbox_service import (
    get_or_create_sandbox,
    touch_sandbox,
    register_local_session,
    get_local_session,
)
from app.services.pty_service import LocalPTYSession
from app.db.session import AsyncSessionLocal
from app.repositories.project_repository import ProjectRepository

router = APIRouter(tags=["terminal"])
logger = logging.getLogger(__name__)


async def _get_workspace_id(project_id: str, user_id: str) -> str:
    async with AsyncSessionLocal() as db:
        repo = ProjectRepository(db)
        project = await repo.get_by_id_and_owner(project_id, user_id)
        if not project or not project.workspace_id:
            raise PermissionError("Not found or forbidden")
        return str(project.workspace_id)


@router.websocket("/ws/terminal/{project_id}")
async def terminal_ws(
    websocket: WebSocket,
    project_id: str,
    token: str = Query(...),
):
    # 1. Auth
    payload = decode_access_token(token)
    if not payload:
        await websocket.close(code=4001, reason="Unauthorized")
        return
    user_id = payload.get("sub")
    if not user_id:
        await websocket.close(code=4001, reason="Unauthorized")
        return

    # 2. Verify project ownership
    try:
        workspace_id = await _get_workspace_id(project_id, user_id)
    except PermissionError:
        await websocket.close(code=4003, reason="Forbidden")
        return

    await websocket.accept()

    # 3. Start or reuse sandbox (Docker or Native Local)
    try:
        sandbox_info = await get_or_create_sandbox(project_id, workspace_id)
    except Exception as e:
        logger.exception("Failed to get/create sandbox for project %s: %s", project_id, e)
        try:
            await websocket.send_text(json.dumps({"type": "error", "message": str(e)}))
            await websocket.close()
        except Exception:
            pass
        return

    mode = sandbox_info.get("mode", "local")
    workspace_path = sandbox_info.get("workspace_path", "")

    # 4. Handle Docker Container Mode
    if mode == "docker":
        try:
            import docker
        except ImportError:
            mode = "local"

    if mode == "docker":
        container_id = sandbox_info["container_id"]
        try:
            await websocket.send_text(json.dumps({
                "type": "connected",
                "container_id": container_id[:12],
                "mode": "docker",
            }))
        except Exception:
            return

        try:
            client = docker.from_env()
            container = client.containers.get(container_id)
            exec_id = client.api.exec_create(
                container.id,
                cmd=["bash"],
                stdin=True,
                tty=True,
                stdout=True,
                stderr=True,
                workdir="/workspace",
            )
            sock = client.api.exec_start(exec_id["Id"], tty=True, socket=True, demux=False)
            sock._sock.setblocking(False)
        except Exception as e:
            logger.exception("Failed to start Docker exec PTY session: %s", e)
            try:
                await websocket.send_text(json.dumps({"type": "error", "message": f"Docker exec error: {e}"}))
                await websocket.close()
            except Exception:
                pass
            return

        loop = asyncio.get_running_loop()

        async def container_to_ws():
            while True:
                try:
                    data = await loop.run_in_executor(None, lambda: sock._sock.recv(4096))
                    if not data:
                        break
                    touch_sandbox(project_id)
                    await websocket.send_bytes(data)
                except Exception:
                    break

        async def ws_to_container():
            while True:
                try:
                    msg = await websocket.receive()
                    if "text" in msg:
                        parsed = json.loads(msg["text"])
                        msg_type = parsed.get("type")
                        if msg_type == "input":
                            data_to_send = parsed.get("data", "").encode("utf-8", errors="replace")
                            await loop.run_in_executor(None, sock._sock.send, data_to_send)
                            touch_sandbox(project_id)
                        elif msg_type == "resize":
                            client.api.exec_resize(
                                exec_id["Id"],
                                height=int(parsed.get("rows", 24)),
                                width=int(parsed.get("cols", 80)),
                            )
                        elif msg_type == "ping":
                            await websocket.send_text(json.dumps({"type": "pong"}))
                    elif "bytes" in msg:
                        await loop.run_in_executor(None, sock._sock.send, msg["bytes"])
                        touch_sandbox(project_id)
                except (WebSocketDisconnect, Exception):
                    break

        try:
            await asyncio.gather(container_to_ws(), ws_to_container())
        finally:
            try:
                sock.close()
            except Exception:
                pass

    # 5. Handle Native Host PTY Fallback Mode (Zero Docker Required)
    else:
        session = get_local_session(project_id)
        if not session or not session.is_running:
            session = LocalPTYSession(project_id, workspace_path)
            await session.start()
            register_local_session(project_id, session)

        try:
            await websocket.send_text(json.dumps({
                "type": "connected",
                "container_id": f"local:{session.shell_name}",
                "mode": "local",
                "shell": session.shell_name,
                "cwd": workspace_path,
            }))
        except Exception:
            return

        _stop = asyncio.Event()

        async def pty_to_ws():
            try:
                while not _stop.is_set() and session.is_running:
                    try:
                        data = await session.read(4096)
                        if data:
                            touch_sandbox(project_id)
                            await websocket.send_bytes(data)
                        elif not session.is_running:
                            break
                        else:
                            # Empty read (timeout) — shell is idle, keep polling
                            await asyncio.sleep(0.05)
                    except (WebSocketDisconnect, RuntimeError):
                        break
                    except Exception:
                        break
            finally:
                _stop.set()

        async def ws_to_pty():
            try:
                while not _stop.is_set() and session.is_running:
                    try:
                        msg = await asyncio.wait_for(
                            websocket.receive(), timeout=1.0
                        )
                        if "text" in msg:
                            parsed = json.loads(msg["text"])
                            msg_type = parsed.get("type")
                            if msg_type == "input":
                                data_to_send = parsed.get("data", "")
                                await session.write(data_to_send)
                                touch_sandbox(project_id)
                            elif msg_type == "resize":
                                cols = int(parsed.get("cols", 80))
                                rows = int(parsed.get("rows", 24))
                                await session.resize(cols, rows)
                            elif msg_type == "ping":
                                await websocket.send_text(json.dumps({"type": "pong"}))
                        elif "bytes" in msg:
                            await session.write(msg["bytes"])
                            touch_sandbox(project_id)
                    except asyncio.TimeoutError:
                        continue
                    except (WebSocketDisconnect, RuntimeError):
                        break
                    except Exception:
                        break
            finally:
                _stop.set()

        try:
            await asyncio.gather(pty_to_ws(), ws_to_pty())
        finally:
            _stop.set()
            try:
                await session.close()
            except Exception:
                pass
