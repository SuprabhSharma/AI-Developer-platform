"use client";

import React, { useState, useMemo, useCallback } from "react";
import Icon from "@/components/Icon";

// ==========================================
// Types for Jupyter Notebook (.ipynb v4)
// ==========================================

export interface NotebookMetadata {
  kernelspec?: {
    display_name?: string;
    language?: string;
    name?: string;
  };
  language_info?: {
    name?: string;
    version?: string;
    pygments_lexer?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface CellOutput {
  output_type: "stream" | "display_data" | "execute_result" | "error";
  name?: string; // for stream: "stdout" | "stderr"
  text?: string | string[]; // for stream
  data?: Record<string, string | string[] | object>; // for display_data / execute_result
  execution_count?: number | null; // for execute_result
  ename?: string; // for error
  evalue?: string; // for error
  traceback?: string[]; // for error
  metadata?: Record<string, unknown>;
}

export interface NotebookCell {
  id?: string;
  cell_type: "code" | "markdown" | "raw";
  source: string | string[];
  execution_count?: number | null;
  outputs?: CellOutput[];
  metadata?: Record<string, unknown>;
}

export interface NotebookData {
  cells: NotebookCell[];
  metadata?: NotebookMetadata;
  nbformat?: number;
  nbformat_minor?: number;
}

interface NotebookViewerProps {
  content: string;
  path: string;
  projectId: string;
  onSwitchToRaw?: () => void;
}

// ==========================================
// Helpers: text normalization & ANSI parsing
// ==========================================

function normalizeText(src: string | string[] | undefined | null): string {
  if (!src) return "";
  if (Array.isArray(src)) return src.join("");
  return String(src);
}

/**
 * Parses terminal ANSI color escape sequences into safe React nodes with styling.
 */
function renderAnsiText(text: string): React.ReactNode {
  // eslint-disable-next-line no-control-regex
  const ansiRegex = /\u001b\[([0-9;]*)m|\x1b\[([0-9;]*)m/g;
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let currentColor = "";
  let isBold = false;
  let isDim = false;

  const colorMap: Record<string, string> = {
    "30": "#484f58",
    "31": "#ff7b72", // red
    "32": "#7ee787", // green
    "33": "#f2cc60", // yellow
    "34": "#58a6ff", // blue
    "35": "#d2a8ff", // magenta/purple
    "36": "#79c0ff", // cyan
    "37": "#e6edf3", // white/gray
    "90": "#6e7681", // bright black (gray)
    "91": "#ffa198", // bright red
    "92": "#56d364", // bright green
    "93": "#e3b341", // bright yellow
    "94": "#79c0ff", // bright blue
    "95": "#d2a8ff", // bright magenta
    "96": "#a5d6ff", // bright cyan
    "97": "#ffffff", // bright white
  };

  let match: RegExpExecArray | null;
  let partKey = 0;

  while ((match = ansiRegex.exec(text)) !== null) {
    const textSegment = text.slice(lastIndex, match.index);
    if (textSegment) {
      parts.push(
        <span
          key={`ansi-${partKey++}`}
          style={{
            color: currentColor || undefined,
            fontWeight: isBold ? 600 : undefined,
            opacity: isDim ? 0.7 : undefined,
          }}
        >
          {textSegment}
        </span>
      );
    }

    const codeStr = match[1] || match[2] || "0";
    const codes = codeStr.split(";");

    for (const code of codes) {
      if (code === "0" || code === "") {
        currentColor = "";
        isBold = false;
        isDim = false;
      } else if (code === "1") {
        isBold = true;
      } else if (code === "2") {
        isDim = true;
      } else if (colorMap[code]) {
        currentColor = colorMap[code];
      }
    }

    lastIndex = ansiRegex.lastIndex;
  }

  const remaining = text.slice(lastIndex);
  if (remaining) {
    parts.push(
      <span
        key={`ansi-${partKey++}`}
        style={{
          color: currentColor || undefined,
          fontWeight: isBold ? 600 : undefined,
          opacity: isDim ? 0.7 : undefined,
        }}
      >
        {remaining}
      </span>
    );
  }

  return parts.length > 0 ? parts : text;
}

// ==========================================
// High-Speed Syntax Highlighter for Code
// ==========================================

function highlightPythonCode(code: string): React.ReactNode {
  const lines = code.split("\n");

  const pythonKeywords = new Set([
    "and", "as", "assert", "async", "await", "break", "class", "continue", "def",
    "del", "elif", "else", "except", "finally", "for", "from", "global", "if",
    "import", "in", "is", "lambda", "nonlocal", "not", "or", "pass", "raise",
    "return", "try", "while", "with", "yield", "True", "False", "None"
  ]);

  const pythonBuiltins = new Set([
    "abs", "all", "any", "bin", "bool", "bytearray", "bytes", "callable", "chr",
    "classmethod", "compile", "complex", "delattr", "dict", "dir", "divmod",
    "enumerate", "eval", "exec", "filter", "float", "format", "frozenset",
    "getattr", "globals", "hasattr", "hash", "help", "hex", "id", "input",
    "int", "isinstance", "issubclass", "iter", "len", "list", "locals", "map",
    "max", "min", "next", "object", "oct", "open", "ord", "pow", "print",
    "property", "range", "repr", "reversed", "round", "set", "setattr",
    "slice", "sorted", "staticmethod", "str", "sum", "super", "tuple", "type",
    "vars", "zip", "self", "cls"
  ]);

  return lines.map((line, lineIdx) => {
    // Check for comment
    const commentIdx = line.indexOf("#");
    const codePart = commentIdx !== -1 ? line.slice(0, commentIdx) : line;
    const commentPart = commentIdx !== -1 ? line.slice(commentIdx) : "";

    // Regex tokenizer for Python
    const tokenRegex = /(f?r?b?["']{3}[\s\S]*?["']{3}|f?r?b?"(?:\\.|[^"\\])*"|f?r?b?'(?:\\.|[^'\\])*'|@[a-zA-Z_]\w*|\b\d+\.?\d*(?:[eE][+-]?\d+)?\b|[a-zA-Z_]\w*|[+\-*/%&|^~<>=!]=?|[(),.:;{}\[\]]|\s+)/g;
    
    const tokens: React.ReactNode[] = [];
    let match: RegExpExecArray | null;
    let lastIdx = 0;
    let tokenKey = 0;

    while ((match = tokenRegex.exec(codePart)) !== null) {
      if (match.index > lastIdx) {
        tokens.push(codePart.slice(lastIdx, match.index));
      }
      const tok = match[0];
      const isString = /^f?r?b?["']/.test(tok);
      const isDecorator = tok.startsWith("@");
      const isNumber = /^\d/.test(tok);

      if (isString) {
        tokens.push(<span key={tokenKey++} className="text-[#a5d6ff]">{tok}</span>);
      } else if (isDecorator) {
        tokens.push(<span key={tokenKey++} className="text-[#d2a8ff] font-medium">{tok}</span>);
      } else if (pythonKeywords.has(tok)) {
        tokens.push(<span key={tokenKey++} className="text-[#ff7b72] font-semibold">{tok}</span>);
      } else if (pythonBuiltins.has(tok)) {
        tokens.push(<span key={tokenKey++} className="text-[#ffa657]">{tok}</span>);
      } else if (isNumber) {
        tokens.push(<span key={tokenKey++} className="text-[#79c0ff]">{tok}</span>);
      } else {
        tokens.push(tok);
      }
      lastIdx = tokenRegex.lastIndex;
    }

    if (lastIdx < codePart.length) {
      tokens.push(codePart.slice(lastIdx));
    }

    return (
      <div key={lineIdx} className="nb-code-line flex min-h-[20px]">
        <span className="nb-line-num select-none text-[#484f58] text-right pr-4 font-mono text-[11px] w-9 flex-shrink-0">
          {lineIdx + 1}
        </span>
        <span className="nb-line-code font-mono text-[12.5px] leading-[20px] whitespace-pre flex-1 text-[#e6edf3]">
          {tokens}
          {commentPart && <span className="text-[#8b949e] italic">{commentPart}</span>}
        </span>
      </div>
    );
  });
}

// ==========================================
// Comprehensive Markdown Renderer
// ==========================================

function renderMarkdownContent(md: string): React.ReactNode {
  const lines = md.split("\n");
  const nodes: React.ReactNode[] = [];
  let i = 0;

  function renderInline(text: string): React.ReactNode {
    const inlineRegex = /(`[^`]+`|\*\*([^*]+)\*\*|\*([^*]+)\*|__([^_]+)__|!\[([^\]]*)\]\(([^)]+)\)|\[([^\]]+)\]\(([^)]+)\)|\$\$?([^$]+)\$\$?)/g;
    const parts: React.ReactNode[] = [];
    let last = 0;
    let match: RegExpExecArray | null;
    let k = 0;

    while ((match = inlineRegex.exec(text)) !== null) {
      if (match.index > last) {
        parts.push(text.slice(last, match.index));
      }
      const raw = match[0];
      if (raw.startsWith("`")) {
        parts.push(
          <code key={k++} className="bg-[#161b22] text-[#79c0ff] px-1.5 py-0.5 rounded text-[12px] font-mono border border-[#30363d]">
            {raw.slice(1, -1)}
          </code>
        );
      } else if (raw.startsWith("![") && match[5] !== undefined && match[6] !== undefined) {
        parts.push(
          // eslint-disable-next-line @next/next/no-img-element
          <img key={k++} src={match[6]} alt={match[5]} className="max-w-full rounded my-2 inline-block" />
        );
      } else if (raw.startsWith("[") && match[7] !== undefined && match[8] !== undefined) {
        parts.push(
          <a key={k++} href={match[8]} target="_blank" rel="noopener noreferrer" className="text-[#58a6ff] hover:underline">
            {match[7]}
          </a>
        );
      } else if (raw.startsWith("**") || raw.startsWith("__")) {
        parts.push(<strong key={k++} className="text-[#f0f6fc] font-bold">{match[2] || match[4]}</strong>);
      } else if (raw.startsWith("*") || raw.startsWith("_")) {
        parts.push(<em key={k++} className="text-[#e6edf3] italic">{match[3]}</em>);
      } else if (raw.startsWith("$")) {
        parts.push(
          <span key={k++} className="font-serif italic text-[#d2a8ff] px-1">
            {match[9]}
          </span>
        );
      }
      last = inlineRegex.lastIndex;
    }
    if (last < text.length) {
      parts.push(text.slice(last));
    }
    return parts.length > 0 ? parts : text;
  }

  while (i < lines.length) {
    const line = lines[i];

    // Blank line
    if (!line.trim()) {
      i++;
      continue;
    }

    // Code block
    if (line.trim().startsWith("```")) {
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith("```")) {
        codeLines.push(lines[i]);
        i++;
      }
      i++;
      nodes.push(
        <div key={`cb-${i}`} className="my-3 bg-[#090d13] border border-[#30363d] rounded-md p-3 overflow-x-auto">
          <pre className="font-mono text-[12px] text-[#e6edf3] m-0">{codeLines.join("\n")}</pre>
        </div>
      );
      continue;
    }

    // Table
    if (line.includes("|") && i + 1 < lines.length && lines[i + 1].includes("---")) {
      const tableHeaders = line.split("|").map((c) => c.trim()).filter(Boolean);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].includes("|") && lines[i].trim() !== "") {
        const rowCells = lines[i].split("|").map((c) => c.trim()).filter(Boolean);
        rows.push(rowCells);
        i++;
      }
      nodes.push(
        <div key={`tbl-${i}`} className="my-3 overflow-x-auto border border-[#30363d] rounded-md">
          <table className="w-full text-[12.5px] border-collapse bg-[#0d1117]">
            <thead>
              <tr className="bg-[#161b22] border-b border-[#30363d]">
                {tableHeaders.map((th, hIdx) => (
                  <th key={hIdx} className="px-3 py-2 text-left font-semibold text-[#f0f6fc] border-r border-[#30363d] last:border-r-0">
                    {renderInline(th)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rIdx) => (
                <tr key={rIdx} className="border-b border-[#21262d] last:border-b-0 hover:bg-[#161b22]/50">
                  {row.map((cell, cIdx) => (
                    <td key={cIdx} className="px-3 py-2 text-[#c9d1d9] border-r border-[#21262d] last:border-r-0">
                      {renderInline(cell)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      continue;
    }

    // Headings
    if (line.startsWith("#")) {
      const level = line.match(/^#+/)?.[0].length || 1;
      const text = line.replace(/^#+\s*/, "");
      const headingClass =
        level === 1
          ? "text-[22px] font-bold text-[#f0f6fc] border-b border-[#30363d] pb-2 mt-4 mb-3"
          : level === 2
          ? "text-[18px] font-bold text-[#f0f6fc] border-b border-[#30363d] pb-1.5 mt-3.5 mb-2.5"
          : level === 3
          ? "text-[15px] font-semibold text-[#f0f6fc] mt-3 mb-2"
          : "text-[13.5px] font-semibold text-[#e6edf3] mt-2 mb-1.5";

      nodes.push(
        <div key={`h-${i}`} className={headingClass}>
          {renderInline(text)}
        </div>
      );
      i++;
      continue;
    }

    // Blockquote
    if (line.startsWith(">")) {
      const quoteText = line.replace(/^>\s*/, "");
      nodes.push(
        <blockquote key={`bq-${i}`} className="border-l-4 border-[#58a6ff] pl-3 py-1 my-2 text-[#8b949e] bg-[#161b22]/40 rounded-r">
          {renderInline(quoteText)}
        </blockquote>
      );
      i++;
      continue;
    }

    // List items
    if (/^(\*|-|\+)\s+/.test(line)) {
      const listItems: string[] = [];
      while (i < lines.length && /^(\*|-|\+)\s+/.test(lines[i])) {
        listItems.push(lines[i].replace(/^(\*|-|\+)\s+/, ""));
        i++;
      }
      nodes.push(
        <ul key={`ul-${i}`} className="list-disc list-inside my-2 space-y-1 text-[#c9d1d9] text-[13px] pl-2">
          {listItems.map((item, idx) => (
            <li key={idx}>{renderInline(item)}</li>
          ))}
        </ul>
      );
      continue;
    }

    // Numbered list
    if (/^\d+\.\s+/.test(line)) {
      const listItems: string[] = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i])) {
        listItems.push(lines[i].replace(/^\d+\.\s+/, ""));
        i++;
      }
      nodes.push(
        <ol key={`ol-${i}`} className="list-decimal list-inside my-2 space-y-1 text-[#c9d1d9] text-[13px] pl-2">
          {listItems.map((item, idx) => (
            <li key={idx}>{renderInline(item)}</li>
          ))}
        </ol>
      );
      continue;
    }

    // Horizontal rule
    if (/^---+$|^\*\*\*+$/.test(line.trim())) {
      nodes.push(<hr key={`hr-${i}`} className="border-[#30363d] my-4" />);
      i++;
      continue;
    }

    // Standard paragraph
    nodes.push(
      <p key={`p-${i}`} className="my-2 text-[13px] leading-relaxed text-[#c9d1d9]">
        {renderInline(line)}
      </p>
    );
    i++;
  }

  return <div className="nb-markdown-body">{nodes}</div>;
}

// ==========================================
// Rich Output Renderer Component
// ==========================================

function CellOutputItem({ output }: { output: CellOutput }) {
  const [isCopied, setIsCopied] = useState(false);

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2000);
  };

  // 1. Stream output (stdout / stderr)
  if (output.output_type === "stream") {
    const text = normalizeText(output.text);
    const isError = output.name === "stderr";

    return (
      <div className={`nb-output-stream font-mono text-[12px] p-2.5 rounded bg-[#090d13] border ${isError ? "border-[#f85149]/40 text-[#ffa198]" : "border-[#30363d]/60 text-[#e6edf3]"} overflow-x-auto whitespace-pre-wrap leading-[18px]`}>
        {renderAnsiText(text)}
      </div>
    );
  }

  // 2. Error output (traceback)
  if (output.output_type === "error") {
    const fullTraceback = (output.traceback || []).join("\n") || `${output.ename}: ${output.evalue}`;

    return (
      <div className="nb-output-error font-mono text-[12px] p-3 rounded-md bg-[#1f1013] border border-[#f85149]/50 text-[#ff7b72] overflow-x-auto whitespace-pre leading-[19px]">
        <div className="flex items-center justify-between pb-1.5 mb-2 border-b border-[#f85149]/30">
          <span className="font-bold text-[#ffa198] text-[12.5px]">
            {output.ename || "Error"}: {output.evalue || "An error occurred"}
          </span>
          <button
            onClick={() => handleCopy(fullTraceback)}
            className="text-[11px] text-[#8b949e] hover:text-[#e6edf3] px-2 py-0.5 rounded bg-[#161b22] border border-[#30363d]"
          >
            {isCopied ? "Copied" : "Copy Traceback"}
          </button>
        </div>
        {renderAnsiText(fullTraceback)}
      </div>
    );
  }

  // 3. Display Data or Execute Result
  if (output.output_type === "display_data" || output.output_type === "execute_result") {
    const data = output.data || {};

    // HTML Output (e.g. Pandas DataFrames)
    if (data["text/html"]) {
      const htmlString = normalizeText(data["text/html"] as string | string[]);

      return (
        <div className="nb-output-html my-1 bg-[#0d1117] border border-[#30363d] rounded-md overflow-hidden">
          <div className="nb-dataframe-container overflow-x-auto max-h-[420px] p-2" dangerouslySetInnerHTML={{ __html: htmlString }} />
        </div>
      );
    }

    // PNG Images (e.g. Matplotlib / Seaborn plots)
    if (data["image/png"]) {
      const base64 = normalizeText(data["image/png"] as string);
      return (
        <div className="nb-output-image my-2 p-2 bg-[#ffffff] rounded-md border border-[#30363d] max-w-fit shadow-md">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`data:image/png;base64,${base64.trim()}`}
            alt="Notebook Plot Output"
            className="max-w-full h-auto rounded select-auto cursor-zoom-in"
            onClick={(e) => {
              const target = e.currentTarget;
              if (target.style.maxWidth === "none") {
                target.style.maxWidth = "100%";
              } else {
                target.style.maxWidth = "none";
              }
            }}
            title="Click to toggle full resolution"
          />
        </div>
      );
    }

    // JPEG Images
    if (data["image/jpeg"]) {
      const base64 = normalizeText(data["image/jpeg"] as string);
      return (
        <div className="nb-output-image my-2 p-2 bg-[#ffffff] rounded-md border border-[#30363d] max-w-fit shadow-md">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`data:image/jpeg;base64,${base64.trim()}`}
            alt="Notebook Plot Output"
            className="max-w-full h-auto rounded"
          />
        </div>
      );
    }

    // SVG Images
    if (data["image/svg+xml"]) {
      const svgContent = normalizeText(data["image/svg+xml"] as string | string[]);
      return (
        <div
          className="nb-output-svg my-2 p-3 bg-white rounded-md border border-[#30363d] overflow-x-auto text-black"
          dangerouslySetInnerHTML={{ __html: svgContent }}
        />
      );
    }

    // JSON Output
    if (data["application/json"]) {
      const jsonStr = JSON.stringify(data["application/json"], null, 2);
      return (
        <pre className="nb-output-json font-mono text-[12px] p-2.5 rounded bg-[#090d13] border border-[#30363d] text-[#7ee787] overflow-x-auto">
          {jsonStr}
        </pre>
      );
    }

    // Markdown Output
    if (data["text/markdown"]) {
      return (
        <div className="nb-output-md p-2 bg-[#090d13] border border-[#30363d] rounded">
          {renderMarkdownContent(normalizeText(data["text/markdown"] as string | string[]))}
        </div>
      );
    }

    // Plain text output fallback
    if (data["text/plain"]) {
      const plainText = normalizeText(data["text/plain"] as string | string[]);
      return (
        <div className="nb-output-plain font-mono text-[12px] p-2.5 rounded bg-[#090d13] border border-[#30363d]/60 text-[#c9d1d9] overflow-x-auto whitespace-pre-wrap leading-[18px]">
          {renderAnsiText(plainText)}
        </div>
      );
    }
  }

  return null;
}

// ==========================================
// Main Notebook Viewer Component
// ==========================================

export default function NotebookViewer({ content, path, projectId, onSwitchToRaw }: NotebookViewerProps) {
  const [collapsedOutputs, setCollapsedOutputs] = useState<Record<number, boolean>>({});
  const [copiedCellIdx, setCopiedCellIdx] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [allOutputsCollapsed, setAllOutputsCollapsed] = useState(false);

  const [liveOutputs, setLiveOutputs] = useState<Map<number, CellOutput[]>>(new Map());
  const [runningCell, setRunningCell] = useState<number | null>(null);
  const [executionCounts, setExecutionCounts] = useState<Map<number, number>>(new Map());

  const runCell = async (cellIndex: number, code: string) => {
    setRunningCell(cellIndex);
    setLiveOutputs((prev) => new Map(prev).set(cellIndex, []));
    const token = localStorage.getItem("access_token") ?? "";

    try {
      // Ensure kernel is started
      await fetch(`/api/backend/projects/${projectId}/kernel/start`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      });

      // Stream cell execution results
      const res = await fetch(`/api/backend/projects/${projectId}/kernel/execute`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ code, cell_index: cellIndex }),
      });

      if (!res.body) {
        throw new Error("No response body received");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const parts = buf.split("\n\n");
        buf = parts.pop() ?? "";
        for (const part of parts) {
          if (!part.startsWith("data: ")) continue;
          const payload = part.slice(6).trim();
          if (payload === "[DONE]") continue;
          try {
            const out: CellOutput = JSON.parse(payload);
            setLiveOutputs((prev) => {
              const next = new Map(prev);
              next.set(cellIndex, [...(next.get(cellIndex) ?? []), out]);
              return next;
            });
            if (out.output_type === "execute_result" && out.execution_count != null) {
              setExecutionCounts((p) => new Map(p).set(cellIndex, out.execution_count!));
            }
          } catch { /* skip */ }
        }
      }
    } catch (err) {
      const errOut: CellOutput = {
        output_type: "error",
        ename: "ExecutionError",
        evalue: err instanceof Error ? err.message : "Failed to execute cell",
        traceback: [],
      };
      setLiveOutputs((prev) => {
        const next = new Map(prev);
        next.set(cellIndex, [...(next.get(cellIndex) ?? []), errOut]);
        return next;
      });
    } finally {
      setRunningCell(null);
    }
  };

  // Parse notebook JSON safely
  const parseResult = useMemo<{ data: NotebookData | null; error: string | null }>(() => {
    if (!content || !content.trim()) {
      return { data: null, error: "File is empty" };
    }
    try {
      const parsed = JSON.parse(content) as NotebookData;
      if (!parsed || !Array.isArray(parsed.cells)) {
        return { data: null, error: "Invalid Jupyter Notebook format (missing cells array)" };
      }
      return { data: parsed, error: null };
    } catch (err) {
      return { data: null, error: err instanceof Error ? err.message : "Failed to parse JSON" };
    }
  }, [content]);

  const toggleOutputCollapse = useCallback((idx: number) => {
    setCollapsedOutputs((prev) => ({
      ...prev,
      [idx]: !prev[idx],
    }));
  }, []);

  const toggleAllOutputs = useCallback(() => {
    const nextState = !allOutputsCollapsed;
    setAllOutputsCollapsed(nextState);
    if (parseResult.data) {
      const update: Record<number, boolean> = {};
      parseResult.data.cells.forEach((_, i) => {
        update[i] = nextState;
      });
      setCollapsedOutputs(update);
    }
  }, [allOutputsCollapsed, parseResult.data]);

  const copyCellCode = useCallback((code: string, idx: number) => {
    navigator.clipboard.writeText(code);
    setCopiedCellIdx(idx);
    setTimeout(() => setCopiedCellIdx(null), 2000);
  }, []);

  // Filter cells if search is active
  const filteredCells = useMemo(() => {
    if (!parseResult.data) return [];
    if (!searchQuery.trim()) return parseResult.data.cells;

    const query = searchQuery.toLowerCase();
    return parseResult.data.cells.filter((cell) => {
      const source = normalizeText(cell.source).toLowerCase();
      if (source.includes(query)) return true;
      if (cell.outputs) {
        return cell.outputs.some((out) => {
          if (out.text && normalizeText(out.text).toLowerCase().includes(query)) return true;
          if (out.ename && out.ename.toLowerCase().includes(query)) return true;
          if (out.evalue && out.evalue.toLowerCase().includes(query)) return true;
          return false;
        });
      }
      return false;
    });
  }, [parseResult.data, searchQuery]);

  // Error parsing state
  if (parseResult.error) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-6 text-center bg-[#0d1117]">
        <div className="w-12 h-12 rounded-full bg-[#f85149]/15 text-[#f85149] flex items-center justify-center mb-3">
          <Icon name="x" size={24} />
        </div>
        <h3 className="text-[16px] font-semibold text-[#f0f6fc] mb-1">Could not render notebook</h3>
        <p className="text-[12.5px] text-[#8b949e] max-w-md mb-4">{parseResult.error}</p>
        {onSwitchToRaw && (
          <button
            onClick={onSwitchToRaw}
            className="px-3.5 py-1.5 text-[12px] font-semibold text-[#58a6ff] bg-[#161b22] border border-[#30363d] rounded-md hover:bg-[#21262d] transition-colors"
          >
            Open in Raw JSON Editor
          </button>
        )}
      </div>
    );
  }

  const notebook = parseResult.data;
  if (!notebook) return null;

  const kernelName =
    notebook.metadata?.kernelspec?.display_name ||
    notebook.metadata?.language_info?.name ||
    "Python 3";

  const totalCells = notebook.cells.length;
  const codeCellsCount = notebook.cells.filter((c) => c.cell_type === "code").length;
  const markdownCellsCount = notebook.cells.filter((c) => c.cell_type === "markdown").length;

  return (
    <div className="notebook-viewer flex flex-col h-full bg-[#0d1117] text-[#e6edf3] select-text overflow-hidden">
      {/* Notebook Toolbar */}
      <div className="notebook-header flex items-center justify-between px-4 py-2 bg-[#161b22] border-b border-[#30363d] flex-shrink-0 text-[12px]">
        {/* Left: Kernel & Meta */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 px-2 py-0.5 bg-[#21262d] border border-[#30363d] rounded text-[#58a6ff] font-medium text-[11.5px]">
            <span className="w-2 h-2 rounded-full bg-[#3fb950]" />
            <span>{kernelName}</span>
          </div>
          <div className="text-[#8b949e] text-[11.5px] hidden sm:flex items-center gap-2">
            <span>{totalCells} cells</span>
            <span>•</span>
            <span>{codeCellsCount} code</span>
            <span>•</span>
            <span>{markdownCellsCount} markdown</span>
          </div>
        </div>

        {/* Right: Actions */}
        <div className="flex items-center gap-2">
          {/* Search box */}
          <div className="relative flex items-center">
            <input
              type="text"
              placeholder="Search notebook..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-36 focus:w-48 transition-all bg-[#0d1117] border border-[#30363d] rounded px-2 py-1 text-[11.5px] text-[#e6edf3] placeholder-[#6e7681] outline-none focus:border-[#58a6ff]"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="absolute right-1.5 text-[#8b949e] hover:text-[#e6edf3]"
              >
                <Icon name="close" size={12} />
              </button>
            )}
          </div>

          <button
            onClick={toggleAllOutputs}
            title={allOutputsCollapsed ? "Expand all outputs" : "Collapse all outputs"}
            className="flex items-center gap-1 px-2.5 py-1 text-[11.5px] text-[#c9d1d9] bg-[#21262d] hover:bg-[#30363d] border border-[#30363d] rounded transition-colors"
          >
            <span>{allOutputsCollapsed ? "Expand Outputs" : "Collapse Outputs"}</span>
          </button>

          {onSwitchToRaw && (
            <button
              onClick={onSwitchToRaw}
              title="View & edit raw JSON structure"
              className="flex items-center gap-1.5 px-2.5 py-1 text-[11.5px] text-[#58a6ff] bg-[#21262d] hover:bg-[#30363d] border border-[#30363d] rounded transition-colors font-medium"
            >
              <Icon name="code" size={13} />
              <span>Raw JSON</span>
            </button>
          )}
        </div>
      </div>

      {/* Notebook Scrollable Body */}
      <div className="notebook-cells-container flex-1 overflow-y-auto px-4 py-5 space-y-4 max-w-5xl mx-auto w-full">
        {filteredCells.length === 0 ? (
          <div className="text-center py-16 text-[#8b949e] text-[13px]">
            No cells match your search &quot;{searchQuery}&quot;
          </div>
        ) : (
          filteredCells.map((cell, idx) => {
            const isCode = cell.cell_type === "code";
            const isMarkdown = cell.cell_type === "markdown";
            const sourceText = normalizeText(cell.source);
            const outputs = cell.outputs || [];
            const hasOutputs = outputs.length > 0;
            const isOutputCollapsed = collapsedOutputs[idx] || false;
            const executionCount = cell.execution_count;

            return (
              <div
                key={cell.id || `cell-${idx}`}
                className={`notebook-cell group rounded-lg border transition-all ${
                  isCode
                    ? "bg-[#161b22]/70 border-[#30363d] hover:border-[#484f58]"
                    : "bg-[#0d1117] border-transparent hover:border-[#30363d]/60 p-2"
                }`}
              >
                {/* 1. CODE CELL */}
                {isCode && (
                  <div className="flex flex-col">
                    {/* Code Cell Header / Gutter */}
                    <div className="flex items-center justify-between px-3 py-1.5 bg-[#161b22] border-b border-[#30363d]/70 text-[11px] select-none rounded-t-lg">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-[#58a6ff] font-semibold">
                          In [{executionCounts.has(idx) ? executionCounts.get(idx) : (executionCount !== null && executionCount !== undefined ? executionCount : " ")}]
                        </span>
                        <span className="text-[#6e7681]">Python</span>
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => void runCell(idx, sourceText)}
                          disabled={runningCell !== null}
                          className="flex items-center gap-1 px-2 py-0.5 text-[11px] bg-[#238636] text-white rounded hover:bg-[#2ea043] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                          title="Run cell"
                        >
                          {runningCell === idx ? (
                            <span className="spinner spinner-small" />
                          ) : (
                            <span>▶</span>
                          )}
                          <span>{runningCell === idx ? "Running…" : "Run"}</span>
                        </button>
                        <button
                          onClick={() => copyCellCode(sourceText, idx)}
                          title="Copy cell code"
                          className="flex items-center gap-1 px-2 py-0.5 text-[#8b949e] hover:text-[#e6edf3] hover:bg-[#21262d] rounded transition-colors text-[11px]"
                        >
                          <Icon name="copy" size={12} />
                          <span>{copiedCellIdx === idx ? "Copied" : "Copy"}</span>
                        </button>
                      </div>
                    </div>

                    {/* Code Editor Content */}
                    <div className="p-3 bg-[#0d1117] overflow-x-auto rounded-b-lg">
                      {highlightPythonCode(sourceText)}
                    </div>

                    {/* Outputs Section */}
                    {((liveOutputs.has(idx) && (liveOutputs.get(idx)?.length ?? 0) > 0) || hasOutputs) && (
                      <div className="mt-1 border-t border-[#30363d]/80 bg-[#12161d] p-3 rounded-b-lg">
                        <div className="flex items-center justify-between mb-2 select-none">
                          <span className="font-mono text-[#7ee787] text-[11px] font-semibold">
                            Out [{executionCounts.has(idx) ? executionCounts.get(idx) : (executionCount !== null && executionCount !== undefined ? executionCount : " ")}]:
                          </span>
                          <button
                            onClick={() => toggleOutputCollapse(idx)}
                            className="text-[10.5px] text-[#8b949e] hover:text-[#e6edf3] px-1.5 py-0.5 rounded bg-[#161b22] border border-[#30363d]"
                          >
                            {isOutputCollapsed ? "Expand Output" : "Collapse Output"}
                          </button>
                        </div>

                        {!isOutputCollapsed && (
                          <div className="space-y-3">
                            {(liveOutputs.has(idx) ? liveOutputs.get(idx)! : outputs).map((out, outIdx) => (
                              <CellOutputItem key={`out-${idx}-${outIdx}`} output={out} />
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* 2. MARKDOWN CELL */}
                {isMarkdown && (
                  <div className="p-2">
                    {renderMarkdownContent(sourceText)}
                  </div>
                )}

                {/* 3. RAW CELL */}
                {!isCode && !isMarkdown && (
                  <pre className="p-3 font-mono text-[12px] text-[#8b949e] bg-[#090d13] border border-[#30363d] rounded overflow-x-auto">
                    {sourceText}
                  </pre>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
