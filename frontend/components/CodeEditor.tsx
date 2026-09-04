"use client";

import { useEffect, useRef, useState } from "react";
import Editor, { loader, type BeforeMount, type OnMount } from "@monaco-editor/react";
import Icon from "@/components/Icon";
import NotebookViewer from "@/components/NotebookViewer";
import { getFileExtension } from "@/lib/fileTree";

// By default @monaco-editor/react pulls the editor runtime from a CDN the
// first time it mounts. That fails silently on machines without outbound
// internet access, which makes the editor pane look permanently blank/frozen
// even though the file tree and file-content API calls all succeed. Serve
// the same assets from our own origin instead (see scripts/copy-monaco-assets.js,
// which runs on `npm install` and copies them into public/monaco-editor/vs).
loader.config({ paths: { vs: "/monaco-editor/vs" } });

const defineForgeTheme: BeforeMount = (monaco) => {
  monaco.editor.defineTheme("forge-dark", {
    base: "vs-dark",
    inherit: true,
    rules: [
      { token: "comment", foreground: "8B949E", fontStyle: "italic" },
      { token: "keyword", foreground: "FF7B72" },
      { token: "string", foreground: "A5D6FF" },
      { token: "number", foreground: "79C0FF" },
      { token: "type", foreground: "FFA657" },
    ],
    colors: {
      "editor.background": "#0d1117",
      "editor.foreground": "#e6edf3",
      "editorLineNumber.foreground": "#484f58",
      "editorLineNumber.activeForeground": "#8b949e",
      "editorCursor.foreground": "#58a6ff",
      "editor.selectionBackground": "#264f78",
      "editor.lineHighlightBackground": "#161b22",
      "editorIndentGuide.background": "#21262d",
    },
  });
};

function getFileIconColorClass(name: string): string {
  const ext = getFileExtension(name);
  switch (ext) {
    case "ts":
    case "tsx":
      return "text-blue-400";
    case "js":
    case "jsx":
      return "text-yellow-400";
    case "py":
      return "text-emerald-400";
    case "json":
      return "text-amber-400";
    case "md":
    case "markdown":
      return "text-purple-400";
    case "css":
    case "scss":
      return "text-cyan-400";
    case "html":
      return "text-orange-400";
    case "sh":
    case "bash":
      return "text-lime-400";
    case "ipynb":
      return "text-orange-400";
    case "png":
    case "jpg":
    case "svg":
      return "text-pink-400";
    default:
      return "text-slate-400";
  }
}

interface CodeEditorProps {
  projectId: string;
  path: string | null;
  content: string;
  onChange: (v: string) => void;
  loading?: boolean;
  openTabs?: string[];
  dirtyPaths?: Set<string>;
  onSelectTab?: (path: string) => void;
  onCloseTab?: (path: string) => void;
  onSave?: () => void;
}

export default function CodeEditor({
  projectId,
  path,
  content,
  onChange,
  loading = false,
  openTabs = [],
  dirtyPaths = new Set(),
  onSelectTab,
  onCloseTab,
  onSave,
}: CodeEditorProps) {
  const [rawJsonModePaths, setRawJsonModePaths] = useState<Set<string>>(new Set());
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        onSaveRef.current?.();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const handleEditorDidMount: OnMount = (editor, monaco) => {
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      onSaveRef.current?.();
    });
  };

  const isNotebook = Boolean(path && path.toLowerCase().endsWith(".ipynb"));
  const isRawMode = Boolean(path && rawJsonModePaths.has(path));

  const handleToggleRawMode = () => {
    if (!path) return;
    setRawJsonModePaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  };

  const tabsToRender = openTabs.length > 0 ? openTabs : path ? [path] : [];

  return (
    <div className="editor-shell flex flex-col h-full bg-[#0d1117]">
      {/* VS Code-style Editor Tab Bar */}
      {tabsToRender.length > 0 && (
        <div className="editor-tab-bar flex items-center bg-[#161b22] border-b border-[#30363d] overflow-x-auto select-none no-scrollbar min-h-[35px] max-h-[35px]">
          {tabsToRender.map((tabPath) => {
            const fileName = tabPath.split("/").pop() || tabPath;
            const isActive = tabPath === path;
            const isDirty = dirtyPaths.has(tabPath);
            const iconColor = getFileIconColorClass(fileName);

            return (
              <div
                key={tabPath}
                className={`editor-tab group flex items-center gap-2 px-3 py-1.5 border-r border-[#30363d] cursor-pointer text-[12px] transition-colors relative min-w-[120px] max-w-[200px] h-[35px] ${
                  isActive
                    ? "bg-[#0d1117] text-[#e6edf3] border-t-2 border-t-[#58a6ff]"
                    : "bg-[#161b22] text-[#8b949e] hover:bg-[#21262d] hover:text-[#e6edf3]"
                }`}
                onClick={() => onSelectTab?.(tabPath)}
                onAuxClick={(e) => {
                  if (e.button === 1) {
                    e.preventDefault();
                    e.stopPropagation();
                    onCloseTab?.(tabPath);
                  }
                }}
                title={tabPath}
              >
                <span className={`flex-shrink-0 ${iconColor}`}>
                  <Icon name="file" size={13} />
                </span>
                <span className="truncate flex-1 font-mono text-[11.5px]">{fileName}</span>
                <div className="flex items-center ml-1">
                  {isDirty ? (
                    <button
                      type="button"
                      className="tab-dirty-indicator w-4 h-4 flex items-center justify-center rounded hover:bg-[#30363d]"
                      onClick={(e) => {
                        e.stopPropagation();
                        onCloseTab?.(tabPath);
                      }}
                      title="Unsaved changes (Close)"
                    >
                      <span className="w-2 h-2 rounded-full bg-[#d29922] group-hover:hidden" />
                      <span className="hidden group-hover:flex text-[12px] text-[#8b949e] hover:text-[#e6edf3]">
                        <Icon name="close" size={11} />
                      </span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="tab-close-btn opacity-0 group-hover:opacity-100 hover:bg-[#30363d] p-0.5 rounded transition-opacity text-[#8b949e] hover:text-[#e6edf3]"
                      onClick={(e) => {
                        e.stopPropagation();
                        onCloseTab?.(tabPath);
                      }}
                      title="Close"
                    >
                      <Icon name="close" size={11} />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Main Editor Body */}
      <div className="relative flex-1 min-h-0 flex flex-col" aria-busy={loading}>
        {!path ? (
          <div className="editor-empty">
            <span className="editor-empty-mark">{`{ }`}</span>
            <strong>Select a file to open it</strong>
            <span>Use the file tree or press <kbd>⌘ K</kbd> to jump to a file.</span>
          </div>
        ) : (
          <>
            {loading && (
              <div className="editor-loading">
                <span className="spinner spinner-small" /> Loading file
              </div>
            )}
            {isNotebook && !isRawMode ? (
              <NotebookViewer
                content={content}
                path={path}
                projectId={projectId}
                onSwitchToRaw={handleToggleRawMode}
              />
            ) : (
              <div className="flex flex-col h-full">
                {isNotebook && isRawMode && (
                  <div className="flex items-center justify-between px-3 py-1.5 bg-[#1f1d14] border-b border-[#d29922]/30 text-[11.5px] text-[#e3b341]">
                    <span>Viewing raw JSON for Jupyter Notebook</span>
                    <button
                      onClick={handleToggleRawMode}
                      className="px-2 py-0.5 text-[11px] font-medium bg-[#21262d] text-[#58a6ff] hover:text-[#79c0ff] border border-[#30363d] rounded"
                    >
                      Switch to Notebook View
                    </button>
                  </div>
                )}
                <div className="flex-1 min-h-0">
                  <Editor
                    height="100%"
                    theme="forge-dark"
                    beforeMount={defineForgeTheme}
                    onMount={handleEditorDidMount}
                    path={path}
                    value={content}
                    onChange={(v) => onChange(v || "")}
                    options={{
                      fontSize: 13,
                      fontFamily: "JetBrains Mono, SFMono-Regular, Consolas, monospace",
                      minimap: { enabled: false },
                      padding: { top: 14 },
                      smoothScrolling: true,
                      scrollBeyondLastLine: false,
                      renderLineHighlight: "line",
                      automaticLayout: true,
                      tabSize: 2,
                      bracketPairColorization: { enabled: true },
                    }}
                  />
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
