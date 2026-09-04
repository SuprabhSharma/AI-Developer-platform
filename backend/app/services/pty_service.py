"""Cross-platform host PTY / Subprocess session manager for zero-Docker terminal execution."""
import asyncio
import logging
import os
import shutil
import subprocess
import sys
import threading
from typing import Optional

logger = logging.getLogger(__name__)

IS_WINDOWS = sys.platform == "win32"

if IS_WINDOWS:
    try:
        import winpty
        HAS_WINPTY = True
    except ImportError:
        HAS_WINPTY = False
else:
    HAS_WINPTY = False
    import fcntl
    import pty
    import struct
    import termios


def _get_default_shell() -> list[str]:
    """Detect the best interactive shell for the host operating system."""
    if IS_WINDOWS:
        cmd = shutil.which("cmd.exe") or shutil.which("cmd") or os.path.expandvars(r"%SystemRoot%\System32\cmd.exe")
        if cmd and os.path.exists(cmd):
            return [cmd]
        powershell = (
            shutil.which("powershell.exe")
            or shutil.which("powershell")
            or os.path.expandvars(r"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe")
        )
        if powershell and os.path.exists(powershell):
            return [powershell, "-NoLogo", "-NoExit"]
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
        self.mode = "winpty" if (IS_WINDOWS and HAS_WINPTY) else ("posix_pty" if not IS_WINDOWS else "pipe")
        self.shell_name = ""
        self._loop: Optional[asyncio.AbstractEventLoop] = None

        # WinPTY state (Windows)
        self._winpty = None

        # POSIX state (Linux / macOS)
        self._master_fd: Optional[int] = None
        self._child_pid: Optional[int] = None

        # Process / Pipe fallback state
        self._subproc: Optional[subprocess.Popen] = None
        self._out_queue: Optional[asyncio.Queue[bytes]] = None
        self._reader_thread: Optional[threading.Thread] = None

    async def start(self, cols: int = 80, rows: int = 24) -> None:
        """Start the interactive host shell in the project workspace directory."""
        self._loop = asyncio.get_running_loop()
        os.makedirs(self.workspace_path, exist_ok=True)
        cmd = _get_default_shell()
        self.shell_name = os.path.basename(cmd[0]).replace(".exe", "")
        self.is_running = True

        if IS_WINDOWS and HAS_WINPTY:
            started = await self._start_winpty(cmd, cols, rows)
            if not started:
                logger.warning("WinPTY failed to start; falling back to async subprocess pipe.")
                await self._start_pipe_fallback(cmd)
        elif not IS_WINDOWS:
            started = await self._start_posix_pty(cmd, cols, rows)
            if not started:
                logger.warning("POSIX PTY failed to start; falling back to async subprocess pipe.")
                await self._start_pipe_fallback(cmd)
        else:
            await self._start_pipe_fallback(cmd)

        logger.info(
            "Started LocalPTYSession (%s) for project %s in %s with shell %s",
            self.mode, self.project_id, self.workspace_path, self.shell_name
        )

    async def _start_winpty(self, cmd: list[str], cols: int, rows: int) -> bool:
        """Spawn Windows pseudo-terminal via WinPTY / ConPTY."""
        try:
            loop = self._loop or asyncio.get_running_loop()
            self._out_queue = asyncio.Queue()

            cols = max(1, min(cols, 500))
            rows = max(1, min(rows, 200))

            pty_instance = winpty.PTY(cols, rows, backend=winpty.enums.Backend.WinPTY)
            args_str = " ".join(cmd[1:]) if len(cmd) > 1 else None
            pty_instance.spawn(cmd[0], cmdline=args_str, cwd=self.workspace_path)

            self._winpty = pty_instance
            self.mode = "winpty"

            def _winpty_reader():
                while self.is_running and self._winpty:
                    try:
                        chunk = self._winpty.read(blocking=True)
                        if chunk:
                            data_bytes = chunk.encode("utf-8", errors="replace")
                            loop.call_soon_threadsafe(self._out_queue.put_nowait, data_bytes)
                    except Exception:
                        break
                self.is_running = False
                try:
                    loop.call_soon_threadsafe(self._out_queue.put_nowait, b"")
                except Exception:
                    pass

            self._reader_thread = threading.Thread(target=_winpty_reader, daemon=True)
            self._reader_thread.start()
            return True
        except Exception as e:
            logger.exception("WinPTY startup exception: %s", e)
            return False

    async def _start_posix_pty(self, cmd: list[str], cols: int, rows: int) -> bool:
        """Spawn POSIX pseudo-terminal on Linux / macOS."""
        try:
            master_fd, slave_fd = pty.openpty()

            winsize = struct.pack("HHHH", rows, cols, 0, 0)
            fcntl.ioctl(master_fd, termios.TIOCSWINSZ, winsize)

            env = dict(os.environ)
            env["TERM"] = "xterm-256color"
            env["COLORTERM"] = "truecolor"

            pid = os.fork()
            if pid == 0:
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
                os.close(slave_fd)
                self._master_fd = master_fd
                self._child_pid = pid
                self.mode = "posix_pty"
                return True
        except Exception as e:
            logger.exception("POSIX PTY startup exception: %s", e)
            return False

    async def _start_pipe_fallback(self, cmd: list[str]) -> None:
        """Universal cross-platform standard subprocess pipe streaming."""
        loop = self._loop or asyncio.get_running_loop()
        self._out_queue = asyncio.Queue()
        env = dict(os.environ)
        env["TERM"] = "xterm-256color"
        env["PYTHONUNBUFFERED"] = "1"

        self._subproc = subprocess.Popen(
            cmd,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            cwd=self.workspace_path,
            env=env,
            bufsize=0,
        )

        def _reader():
            while self.is_running and self._subproc and self._subproc.stdout:
                try:
                    data = self._subproc.stdout.read(4096)
                    if not data:
                        break
                    loop.call_soon_threadsafe(self._out_queue.put_nowait, data)
                except Exception:
                    break
            self.is_running = False
            try:
                loop.call_soon_threadsafe(self._out_queue.put_nowait, b"")
            except Exception:
                pass

        self._reader_thread = threading.Thread(target=_reader, daemon=True)
        self._reader_thread.start()
        self.mode = "pipe"

    async def read(self, max_bytes: int = 4096) -> bytes:
        """Read output from the terminal session in an asynchronous manner."""
        if not self.is_running and (not self._out_queue or self._out_queue.empty()):
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

        elif self._out_queue:
            if not self.is_running and self._out_queue.empty():
                return b""
            try:
                return await asyncio.wait_for(self._out_queue.get(), timeout=0.05)
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

        loop = self._loop or asyncio.get_running_loop()

        if self.mode == "winpty" and self._winpty:
            if isinstance(data, bytes):
                data_str = data.decode("utf-8", errors="replace")
            else:
                data_str = str(data)

            def _sync_winpty_write():
                try:
                    self._winpty.write(data_str)
                except Exception as e:
                    logger.debug("Error writing to WinPTY: %s", e)

            try:
                await loop.run_in_executor(None, _sync_winpty_write)
            except Exception:
                pass

        elif self.mode == "posix_pty" and self._master_fd is not None:
            if isinstance(data, str):
                data_bytes = data.encode("utf-8", errors="replace")
            else:
                data_bytes = data

            def _sync_posix_write():
                try:
                    os.write(self._master_fd, data_bytes)
                except Exception as e:
                    logger.debug("Error writing to POSIX PTY: %s", e)

            try:
                await loop.run_in_executor(None, _sync_posix_write)
            except Exception:
                pass

        elif self._subproc and self._subproc.stdin:
            if isinstance(data, str):
                data_bytes = data.encode("utf-8", errors="replace")
            else:
                data_bytes = data

            def _sync_pipe_write():
                try:
                    self._subproc.stdin.write(data_bytes)
                    self._subproc.stdin.flush()
                except Exception as e:
                    logger.debug("Error writing to pipe stdin: %s", e)

            try:
                await loop.run_in_executor(None, _sync_pipe_write)
            except Exception:
                pass

    async def resize(self, cols: int, rows: int) -> None:
        """Resize the virtual terminal window dimensions."""
        if not self.is_running:
            return

        cols = max(1, min(cols, 500))
        rows = max(1, min(rows, 200))

        if self.mode == "winpty" and self._winpty:
            try:
                self._winpty.set_size(cols, rows)
            except Exception as e:
                logger.debug("Failed to resize WinPTY: %s", e)

        elif self.mode == "posix_pty" and self._master_fd is not None:
            try:
                winsize = struct.pack("HHHH", rows, cols, 0, 0)
                fcntl.ioctl(self._master_fd, termios.TIOCSWINSZ, winsize)
            except Exception as e:
                logger.debug("Failed to resize POSIX PTY: %s", e)

    async def close(self) -> None:
        """Close and clean up the terminal process and resources."""
        self.is_running = False

        if self.mode == "winpty" and self._winpty:
            try:
                self._winpty.cancel_io()
            except Exception:
                pass
            try:
                pid = self._winpty.pid
                if pid:
                    import signal
                    os.kill(pid, signal.SIGTERM)
            except Exception:
                pass
            self._winpty = None

        elif self.mode == "posix_pty":
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

        if self._subproc:
            try:
                self._subproc.terminate()
            except Exception:
                try:
                    self._subproc.kill()
                except Exception:
                    pass
            self._subproc = None

        logger.info("Closed LocalPTYSession for project %s", self.project_id)
