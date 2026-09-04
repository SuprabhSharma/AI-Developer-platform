"use client";
import { useEffect, useRef, useState, useCallback } from "react";
import { Terminal } from "xterm";
import { FitAddon } from "xterm-addon-fit";
import { WebLinksAddon } from "xterm-addon-web-links";
import "xterm/css/xterm.css";
import Icon from "@/components/Icon";

// WebSocket connects directly to port 8000 (can't proxy WS through Next.js rewrites)
const WS_BASE = typeof window !== "undefined"
  ? window.location.origin.replace(/^http/, "ws").replace(":3000", ":8000")
  : "ws://localhost:8000";

const RECONNECT_DELAYS = [500, 1000, 2000, 5000, 10000, 30000];
type Status = "connecting" | "connected" | "disconnected" | "error";

const DEFAULT_DIMENSIONS = {
  css: { cell: { width: 0, height: 0 }, canvas: { width: 0, height: 0 } },
  device: { cell: { width: 0, height: 0 }, char: { width: 0, height: 0, left: 0, top: 0 }, canvas: { width: 0, height: 0 } },
  scaledCharWidth: 0,
  scaledCharHeight: 0,
  scaledCellWidth: 0,
  scaledCellHeight: 0,
  scaledCharLeft: 0,
  scaledCharTop: 0,
  scaledCanvasWidth: 0,
  scaledCanvasHeight: 0,
  canvasWidth: 0,
  canvasHeight: 0,
  actualCellWidth: 0,
  actualCellHeight: 0,
};

/**
 * Patch RenderService.prototype.dimensions to avoid "Cannot read properties of undefined (reading 'dimensions')"
 * when xterm's Viewport executes pending animation frame or timeout callbacks during/after disposal or before renderer is attached.
 */
function ensureSafeRenderDimensions(term: Terminal) {
  try {
    const renderService = (term as unknown as { _core?: { _renderService?: object } })._core?._renderService;
    if (!renderService) return;
    const proto = Object.getPrototypeOf(renderService);
    if (proto && !(proto as { __safeDimensionsPatched?: boolean }).__safeDimensionsPatched) {
      const desc = Object.getOwnPropertyDescriptor(proto, "dimensions");
      if (desc?.get) {
        const originalGet = desc.get;
        Object.defineProperty(proto, "dimensions", {
          get() {
            try {
              if (!(this as { _renderer?: { value?: unknown } })._renderer?.value) {
                return DEFAULT_DIMENSIONS;
              }
              return originalGet.call(this);
            } catch {
              return DEFAULT_DIMENSIONS;
            }
          },
          configurable: true,
          enumerable: true,
        });
        (proto as { __safeDimensionsPatched?: boolean }).__safeDimensionsPatched = true;
      }
    }
  } catch {
    // Ignore prototype inspection failures in strict environments
  }
}

export default function TerminalPanelInner({ projectId }: { projectId: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const retryRef = useRef(0);
  const timerRef = useRef<number | null>(null);
  const mountedRef = useRef(true);
  const [status, setStatus] = useState<Status>("connecting");
  const [sessionLabel, setSessionLabel] = useState<string | null>(null);
  const [sessionMode, setSessionMode] = useState<"docker" | "local">("local");

  const safeFit = useCallback(() => {
    if (!mountedRef.current || !containerRef.current || !fitRef.current || !termRef.current) return;
    const { clientWidth, clientHeight } = containerRef.current;
    if (clientWidth <= 0 || clientHeight <= 0) return;
    try {
      fitRef.current.fit();
      const t = termRef.current;
      if (t && wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: "resize", cols: t.cols, rows: t.rows }));
      }
    } catch {
      // Ignore fit errors caused by transient layout updates
    }
  }, []);

  const connect = useCallback(() => {
    if (!mountedRef.current) return;
    const token = localStorage.getItem("access_token");
    if (!token) { setStatus("error"); return; }

    setStatus("connecting");
    const ws = new WebSocket(`${WS_BASE}/api/v1/ws/terminal/${projectId}?token=${encodeURIComponent(token)}`);
    ws.binaryType = "arraybuffer";
    wsRef.current = ws;

    ws.onopen = () => {
      retryRef.current = 0;
      safeFit();
    };

    ws.onmessage = (e) => {
      if (!mountedRef.current) return;
      const t = termRef.current; if (!t) return;
      if (typeof e.data === "string") {
        try {
          const msg = JSON.parse(e.data);
          if (msg.type === "connected") {
            setStatus("connected");
            if (msg.mode === "docker") {
              setSessionMode("docker");
              setSessionLabel(`Docker: ${msg.container_id}`);
              t.writeln(`\r\n\x1b[32m✓ Connected to Docker container sandbox (${msg.container_id})\x1b[0m\r\n`);
            } else {
              setSessionMode("local");
              const shellName = msg.shell || "Host Shell";
              setSessionLabel(`Local: ${shellName}`);
              t.writeln(`\r\n\x1b[32m✓ Connected to native host shell (${shellName})\x1b[0m`);
              if (msg.cwd) {
                t.writeln(`\x1b[90mWorkspace: ${msg.cwd}\x1b[0m\r\n`);
              } else {
                t.writeln("");
              }
            }
          } else if (msg.type === "error") {
            setStatus("error");
            t.writeln(`\r\n\x1b[31m✗ ${msg.message}\x1b[0m\r\n`);
          }
        } catch { t.write(e.data); }
      } else {
        t.write(new Uint8Array(e.data));
      }
    };

    ws.onclose = (e) => {
      if (!mountedRef.current) return;
      setStatus("disconnected");
      termRef.current?.writeln(`\r\n\x1b[33m[Disconnected: ${e.reason || "connection closed"}]\x1b[0m\r\n`);
      const delay = RECONNECT_DELAYS[Math.min(retryRef.current++, RECONNECT_DELAYS.length - 1)];
      timerRef.current = window.setTimeout(connect, delay);
    };

    ws.onerror = () => { if (mountedRef.current) setStatus("error"); };
  }, [projectId, safeFit]);

  useEffect(() => {
    if (!containerRef.current) return;
    mountedRef.current = true;

    // Clean up container children if any exist from previous renders
    containerRef.current.innerHTML = "";

    const term = new Terminal({
      theme: {
        background: "#0d1117", foreground: "#e6edf3",
        cursor: "#58a6ff", selectionBackground: "#264f78",
        red: "#ff7b72", green: "#3fb950", yellow: "#e3b341",
        blue: "#58a6ff", magenta: "#d2a8ff", cyan: "#39c5cf",
      },
      fontFamily: "JetBrains Mono, SFMono-Regular, Consolas, monospace",
      fontSize: 13, lineHeight: 1.4,
      cursorBlink: true, cursorStyle: "block", scrollback: 10000,
    });

    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon());
    term.open(containerRef.current);
    ensureSafeRenderDimensions(term);

    termRef.current = term;
    fitRef.current = fit;

    // Forward all keystrokes to WebSocket
    term.onData((data) => {
      if (wsRef.current?.readyState === WebSocket.OPEN)
        wsRef.current.send(JSON.stringify({ type: "input", data }));
    });

    // Schedule initial safe fit once container layout is resolved
    const rafId = requestAnimationFrame(() => {
      safeFit();
    });
    const fitTimer = setTimeout(() => {
      safeFit();
    }, 50);

    // Auto-resize on container size change
    const ro = new ResizeObserver(() => {
      safeFit();
    });
    if (containerRef.current) ro.observe(containerRef.current);

    // Keepalive
    const ping = setInterval(() => {
      if (wsRef.current?.readyState === WebSocket.OPEN)
        wsRef.current.send(JSON.stringify({ type: "ping" }));
    }, 30_000);

    connect();

    return () => {
      mountedRef.current = false;
      cancelAnimationFrame(rafId);
      clearTimeout(fitTimer);
      if (timerRef.current) clearTimeout(timerRef.current);
      clearInterval(ping);
      ro.disconnect();
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.onerror = null;
        wsRef.current.close();
        wsRef.current = null;
      }
      termRef.current = null;
      fitRef.current = null;
      try {
        term.dispose();
      } catch {
        // Ignore errors during terminal teardown
      }
    };
  }, [connect, safeFit]);

  const statusColor = {
    connecting: "text-yellow-400",
    connected: "text-green-400",
    disconnected: "text-orange-400",
    error: "text-red-400"
  }[status];

  const statusText = {
    connecting: "Connecting…",
    connected: sessionLabel ? `${sessionMode === "local" ? "⚡ " : "🐳 "}${sessionLabel}` : "Connected",
    disconnected: "Disconnected — reconnecting…",
    error: "Error"
  }[status];

  return (
    <div className="flex flex-col h-full bg-[#0d1117]">
      <div className="flex items-center justify-between px-3 py-1 bg-[#161b22] border-b border-[#30363d] min-h-[32px]">
        <div className="flex items-center gap-2">
          <Icon name="terminal" size={13} />
          <span className="text-[11px] font-medium text-[#e6edf3]">Terminal</span>
          <span className={`text-[11px] ${statusColor}`}>— {statusText}</span>
        </div>
        <div className="flex items-center gap-1">
          {(status === "disconnected" || status === "error") && (
            <button onClick={() => { retryRef.current = 0; wsRef.current?.close(); connect(); }}
              className="px-2 py-0.5 text-[11px] bg-[#21262d] text-[#58a6ff] border border-[#30363d] rounded hover:bg-[#30363d]">
              Reconnect
            </button>
          )}
          <button onClick={() => termRef.current?.clear()}
            className="px-2 py-0.5 text-[11px] bg-[#21262d] text-[#8b949e] border border-[#30363d] rounded hover:bg-[#30363d]">
            Clear
          </button>
        </div>
      </div>
      <div ref={containerRef} className="flex-1 min-h-0 p-1" style={{ backgroundColor: "#0d1117" }} />
    </div>
  );
}
