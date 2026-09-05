"""WebSocket PTY bridge: browser xterm.js ↔ Docker container bash OR Native Host PTY."""
import asyncio
import json
import logging
import uuid
from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect
from sqlalchemy import select
from app.core.security import decode_access_token
from app.services.sandbox_service import (
    get_or_create_sandbox,
    touch_sandbox,
    register_local_session,
    get_local_session,
)
from app.services.pty_service import LocalPTYSession
from app.db.session import AsyncSessionLocal
from app.models.project import Project, Workspace
from app.models.user import Membership
from app.repositories.project_repository import ProjectRepository
from app.repositories.user_repository import UserRepository

router = APIRouter(tags=["terminal"])
logger = logging.getLogger(__name__)


async def _get_workspace_id(project_id: str, user_id: str) -> str:
    async with AsyncSessionLocal() as db:
        user_repo = UserRepository(db)
        try:
            uid = uuid.UUID(str(user_id))
            pid = uuid.UUID(str(project_id))
        except (ValueError, TypeError) as e:
            raise PermissionError(f"Invalid identifier: {e}")

        user = await user_repo.get_by_id(uid)
        if not user or not user.is_active:
            raise PermissionError("User not found or inactive")

        project_repo = ProjectRepository(db)
        project = await project_repo.get_by_id(pid)
        if not project:
            raise PermissionError("Project not found")

        # Check ownership or organization membership
        if project.owner_id != uid:
            result = await db.execute(
                select(Membership).where(
                    Membership.user_id == uid,
                    Membership.organization_id == project.organization_id,
                )
            )
            if not result.scalar_one_or_none():
                raise PermissionError("Access forbidden to this project")

        if not project.workspaces:
            workspace = await project_repo.create_workspace(Workspace(project_id=project.id, name="main"))
            await db.commit()
            return str(workspace.id)

        return str(project.workspaces[0].id)


@router.websocket("/ws/terminal/{project_id}")
async def terminal_ws(
    websocket: WebSocket,
    project_id: str,
    token: str = Query(...),
):
    await websocket.accept()

    # 1. Auth
    payload = decode_access_token(token)
    if not payload:
        logger.warning("Terminal WebSocket auth failed: invalid or expired token for project %s", project_id)
        try:
            await websocket.send_text(json.dumps({
                "type": "error",
                "message": "Authentication failed or token expired. Please refresh your session.",
            }))
            await websocket.close(code=4001, reason="Unauthorized")
        except Exception:
            pass
        return

    user_id = payload.get("sub")
    if not user_id:
        try:
            await websocket.send_text(json.dumps({"type": "error", "message": "Invalid token subject"}))
            await websocket.close(code=4001, reason="Unauthorized")
        except Exception:
            pass
        return

    # 2. Verify project ownership & workspace
    try:
        workspace_id = await _get_workspace_id(project_id, user_id)
    except PermissionError as e:
        logger.warning("Terminal WebSocket forbidden: %s (project=%s, user=%s)", e, project_id, user_id)
        try:
            await websocket.send_text(json.dumps({"type": "error", "message": str(e)}))
            await websocket.close(code=4003, reason="Forbidden")
        except Exception:
            pass
        return

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

        # A reconnect must not leave two reader/writer pairs attached to the
        # same PTY. Mark the new owner before closing the old socket so its
        # tasks also fail the ownership check while they wind down.
        previous_websocket = session.active_websocket
        session.active_websocket = websocket
        if previous_websocket is not None and previous_websocket is not websocket:
            logger.info("Replacing stale terminal WebSocket for project %s", project_id)
            try:
                await previous_websocket.close(code=4009, reason="Replaced by newer terminal connection")
            except Exception:
                pass

        try:
            await websocket.send_text(json.dumps({
                "type": "connected",
                "container_id": f"local:{session.shell_name}",
                "mode": "local",
                "shell": session.shell_name,
                "cwd": workspace_path,
            }))
        except Exception:
            if session.active_websocket is websocket:
                session.active_websocket = None
            return

        _stop = asyncio.Event()

        async def pty_to_ws():
            try:
                while (
                    not _stop.is_set()
                    and session.is_running
                    and session.active_websocket is websocket
                ):
                    try:
                        data = await session.read(4096)
                        if data:
                            if session.active_websocket is not websocket:
                                break
                            touch_sandbox(project_id)
                            await websocket.send_bytes(data)
                        elif not session.is_running:
                            break
                        else:
                            # Empty read (timeout) — shell is idle, brief yield
                            await asyncio.sleep(0.01)
                    except (WebSocketDisconnect, RuntimeError):
                        break
                    except Exception:
                        break
            finally:
                _stop.set()

        async def ws_to_pty():
            try:
                while (
                    not _stop.is_set()
                    and session.is_running
                    and session.active_websocket is websocket
                ):
                    try:
                        msg = await asyncio.wait_for(
                            websocket.receive(), timeout=1.0
                        )
                        if session.active_websocket is not websocket:
                            break
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
            if session.active_websocket is websocket:
                session.active_websocket = None
            if not session.is_running:
                try:
                    await session.close()
                except Exception:
                    pass
