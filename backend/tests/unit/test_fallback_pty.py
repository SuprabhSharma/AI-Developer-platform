"""Unit tests for Native Subprocess / Host PTY Fallback and Docker Auto-detection."""
import asyncio
import os
import pytest
from app.services.pty_service import LocalPTYSession, _get_default_shell
from app.services.sandbox_service import (
    is_docker_available,
    get_or_create_sandbox,
    stop_sandbox,
    touch_sandbox,
    _registry,
)


@pytest.mark.asyncio
async def test_docker_auto_detection():
    available = is_docker_available()
    assert isinstance(available, bool)


@pytest.mark.asyncio
async def test_get_or_create_sandbox():
    proj_id = "unit-test-proj-fallback"
    ws_id = "unit-test-ws-fallback"
    try:
        sb = await get_or_create_sandbox(proj_id, ws_id)
        assert "mode" in sb
        assert sb["mode"] in ("docker", "local")
        assert "workspace_path" in sb
        assert os.path.exists(sb["workspace_path"])
    finally:
        await stop_sandbox(proj_id)
        assert proj_id not in _registry


def test_default_shell_detection():
    shell_cmd = _get_default_shell()
    assert isinstance(shell_cmd, list)
    assert len(shell_cmd) > 0
    # On Windows, should be powershell or cmd; on POSIX, a shell path
    import sys
    if sys.platform == "win32":
        assert any(name in shell_cmd[0].lower() for name in ("powershell", "pwsh", "cmd"))
    else:
        assert shell_cmd[0].startswith("/")


@pytest.mark.asyncio
async def test_local_pty_lifecycle():
    proj_id = "unit-test-pty-lifecycle"
    ws_path = "./storage_data/workspaces/test-ws-lifecycle"
    os.makedirs(ws_path, exist_ok=True)
    session = LocalPTYSession(proj_id, ws_path)

    await session.start(cols=80, rows=24)
    assert session.is_running is True
    assert session.shell_name != ""

    await session.resize(100, 30)
    await session.write("echo TEST_OK\r\n")

    await session.close()
    assert session.is_running is False


@pytest.mark.asyncio
async def test_read_returns_output():
    """Verify that writing a command and reading returns actual output."""
    proj_id = "unit-test-pty-read"
    ws_path = "./storage_data/workspaces/test-ws-read"
    os.makedirs(ws_path, exist_ok=True)
    session = LocalPTYSession(proj_id, ws_path)

    try:
        await session.start(cols=80, rows=24)
        assert session.is_running is True

        # Collect all output with a timeout
        collected = b""
        deadline = asyncio.get_event_loop().time() + 5.0
        while asyncio.get_event_loop().time() < deadline:
            data = await session.read(4096)
            if data:
                collected += data
            if collected:
                # Got at least some output (the prompt)
                break
            await asyncio.sleep(0.05)

        # We should have received the shell prompt
        assert len(collected) > 0, "Expected to receive shell prompt output"

        # Send a command
        await session.write("echo PTY_READ_OK\r\n")
        await asyncio.sleep(1.0)

        # Read the response
        response = b""
        deadline = asyncio.get_event_loop().time() + 5.0
        while asyncio.get_event_loop().time() < deadline:
            data = await session.read(4096)
            if data:
                response += data
            if b"PTY_READ_OK" in response:
                break
            await asyncio.sleep(0.05)

        assert b"PTY_READ_OK" in response, f"Expected 'PTY_READ_OK' in output, got: {response!r}"
    finally:
        await session.close()
        assert session.is_running is False


@pytest.mark.asyncio
async def test_read_does_not_block_on_idle():
    """Verify that read() returns b'' on idle instead of blocking forever."""
    proj_id = "unit-test-pty-noblock"
    ws_path = "./storage_data/workspaces/test-ws-noblock"
    os.makedirs(ws_path, exist_ok=True)
    session = LocalPTYSession(proj_id, ws_path)

    try:
        await session.start(cols=80, rows=24)

        # Drain the initial prompt
        deadline = asyncio.get_event_loop().time() + 3.0
        while asyncio.get_event_loop().time() < deadline:
            data = await session.read(4096)
            if not data:
                break
            await asyncio.sleep(0.05)

        # Now the shell is idle — read() should return b"" quickly (not block)
        start = asyncio.get_event_loop().time()
        result = await asyncio.wait_for(session.read(4096), timeout=2.0)
        elapsed = asyncio.get_event_loop().time() - start

        assert result == b"", f"Expected empty bytes on idle, got: {result!r}"
        assert elapsed < 1.0, f"read() took {elapsed:.2f}s — should return quickly on idle"
    finally:
        await session.close()
