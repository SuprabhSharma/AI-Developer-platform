"""Cross-platform host PTY / Subprocess session manager for zero-Docker terminal execution."""
import asyncio
import logging
import os
import shutil
import sys
from typing import Optional

logger = logging.getLogger(__name__)

IS_WINDOWS = sys.platform == "win32"

if not IS_WINDOWS:
    import fcntl
    import pty
    import struct
    import termios


def _get_default_shell() -> list[str]:
    """Detect the best interactive shell for the host operating system."""
    if IS_WINDOWS:
        # Check for PowerShell 7 (pwsh), Windows PowerShell, or cmd.exe
        pwsh = shutil.which("pwsh.exe") or shutil.which("pwsh")
        if pwsh:
            return [pwsh, "-NoLogo"]
        powershell = shutil.which("powershell.exe") or shutil.which("powershell")
        if powershell:
            return [powershell, "-NoLogo"]
        cmd = shutil.which("cmd.exe") or shutil.which("cmd")
        if cmd:
            return [cmd]
        return ["cmd.exe"]
    else:
        shell = os.environ.get("SHELL")
        if shell and shutil.which(shell):
            return [shell]
        for candidate in ["/bin/bash", "/usr/bin/bash", "/bin/zsh", "/bin/sh"]:
            if shutil.which(candidate):
                return [candidate]
        return ["/bin/sh"]


class LocalPTYSession:
    """Represents a native host interactive terminal session."""

    def __init__(self, project_id: str, workspace_path: str):
        self.project_id = project_id
        self.workspace_path = os.path.abspath(workspace_path)
        self.is_running = False
        self.mode = "pipe" if IS_WINDOWS else "posix_pty"
        self.shell_name = ""
        self._loop: Optional[asyncio.AbstractEventLoop] = None

        # POSIX state
        self._master_fd: Optional[int] = None
        self._child_pid: Optional[int] = None

        # Process state
        self._proc: Optional[asyncio.subprocess.Process] = None

    async def start(self, cols: int = 80, rows: int = 24) -> None:
        """Start the interactive host shell in the project workspace directory."""
        self._loop = asyncio.get_running_loop()
        os.makedirs(self.workspace_path, exist_ok=True)
        cmd = _get_default_shell()
        self.shell_name = os.path.basename(cmd[0])

        if IS_WINDOWS:
            await self._start_pipe_fallback(cmd)
        else:
            started = await self._start_posix_pty(cmd, cols, rows)
            if not started:
                logger.warning("POSIX PTY failed to start; falling back to async subprocess pipe.")
                await self._start_pipe_fallback(cmd)

        self.is_running = True
        logger.info(
            "Started LocalPTYSession (%s) for project %s in %s with shell %s",
            self.mode, self.project_id, self.workspace_path, self.shell_name
        )

    async def _start_posix_pty(self, cmd: list[str], cols: int, rows: int) -> bool:
        """Spawn POSIX pseudo-terminal on Linux / macOS."""
        try:
            master_fd, slave_fd = pty.openpty()

            # Set initial size
            winsize = struct.pack("HHHH", rows, cols, 0, 0)
            fcntl.ioctl(master_fd, termios.TIOCSWINSZ, winsize)

            env = dict(os.environ)
            env["TERM"] = "xterm-256color"
            env["COLORTERM"] = "truecolor"

            pid = os.fork()
            if pid == 0:
                # Child process
                os.setsid()
                fcntl.ioctl(slave_fd, termios.TIOCSCTTY, 0)
                os.dup2(slave_fd, 0)
                os.dup2(slave_fd, 1)
                os.dup2(slave_fd, 2)
                if slave_fd > 2:
                    os.close(slave_fd)
                if master_fd > 2:
                    os.close(master_fd)

                try:
                    os.chdir(self.workspace_path)
                except Exception:
                    pass

                os.execvpe(cmd[0], cmd, env)
            else:
                # Parent process
                os.close(slave_fd)
                self._master_fd = master_fd
                self._child_pid = pid
                self.mode = "posix_pty"
                return True
        except Exception as e:
            logger.exception("POSIX PTY startup exception: %s", e)
            return False

    async def _start_pipe_fallback(self, cmd: list[str]) -> None:
        """Asynchronous standard subprocess pipe streaming."""
        env = dict(os.environ)
        env["TERM"] = "xterm-256color"
        env["PYTHONUNBUFFERED"] = "1"
        self._proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
            cwd=self.workspace_path,
            env=env,
        )
        self.mode = "pipe"

    async def read(self, max_bytes: int = 4096) -> bytes:
        """Read output from the terminal session in an asynchronous manner."""
        if not self.is_running:
            return b""

        loop = self._loop or asyncio.get_running_loop()

        if self.mode == "posix_pty" and self._master_fd is not None:
            def _sync_posix_read():
                try:
                    return os.read(self._master_fd, max_bytes)
                except (OSError, IOError):
                    return b""

            while self.is_running:
                try:
                    data = await loop.run_in_executor(None, _sync_posix_read)
                    if data:
                        return data
                    await asyncio.sleep(0.02)
                except Exception:
                    self.is_running = False
                    return b""
            return b""

        elif self._proc and self._proc.stdout:
            try:
                data = await asyncio.wait_for(self._proc.stdout.read(max_bytes), timeout=0.1)
                if not data:
                    self.is_running = False
                return data
            except asyncio.TimeoutError:
                return b""
            except Exception:
                self.is_running = False
                return b""

        return b""

    async def write(self, data: bytes | str) -> None:
        """Write input to the terminal session."""
        if not self.is_running:
            return

        if isinstance(data, str):
            data = data.encode("utf-8", errors="replace")

        loop = self._loop or asyncio.get_running_loop()

        if self.mode == "posix_pty" and self._master_fd is not None:
            def _sync_posix_write():
                try:
                    os.write(self._master_fd, data)
                except Exception as e:
                    logger.debug("Error writing to POSIX PTY: %s", e)

            try:
                await loop.run_in_executor(None, _sync_posix_write)
            except Exception:
                pass

        elif self._proc and self._proc.stdin:
            try:
                self._proc.stdin.write(data)
                await self._proc.stdin.drain()
            except Exception:
                pass

    async def resize(self, cols: int, rows: int) -> None:
        """Resize the virtual terminal window dimensions."""
        if not self.is_running:
            return

        cols = max(1, min(cols, 500))
        rows = max(1, min(rows, 200))

        if self.mode == "posix_pty" and self._master_fd is not None:
            try:
                winsize = struct.pack("HHHH", rows, cols, 0, 0)
                fcntl.ioctl(self._master_fd, termios.TIOCSWINSZ, winsize)
            except Exception as e:
                logger.debug("Failed to resize POSIX PTY: %s", e)

    async def close(self) -> None:
        """Close and clean up the terminal process and resources."""
        self.is_running = False

        if self.mode == "posix_pty":
            if self._master_fd is not None:
                try:
                    os.close(self._master_fd)
                except Exception:
                    pass
                self._master_fd = None

            if self._child_pid:
                try:
                    import signal
                    os.kill(self._child_pid, signal.SIGTERM)
                except Exception:
                    pass
                self._child_pid = None

        if self._proc:
            try:
                self._proc.terminate()
                await asyncio.wait_for(self._proc.wait(), timeout=2.0)
            except Exception:
                try:
                    self._proc.kill()
                except Exception:
                    pass
            self._proc = None

        logger.info("Closed LocalPTYSession for project %s", self.project_id)
