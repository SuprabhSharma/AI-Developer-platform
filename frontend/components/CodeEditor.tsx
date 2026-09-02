"use client";

import Editor from "@monaco-editor/react";

function defineForgeTheme(monaco: { editor: { defineTheme: (name: string, theme: object) => void } }) {
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
}

export default function CodeEditor({ path, content, onChange, loading = false }: { path: string | null; content: string; onChange: (v: string) => void; loading?: boolean }) {
  if (!path) {
    return <div className="editor-empty"><span className="editor-empty-mark">{`{ }`}</span><strong>Select a file to open it</strong><span>Use the file tree or press <kbd>⌘ K</kbd> to jump to a file.</span></div>;
  }
  return (
    <div className="editor-shell" aria-busy={loading}>
      {loading && <div className="editor-loading"><span className="spinner spinner-small" /> Loading file</div>}
      <Editor height="100%" theme="forge-dark" beforeMount={defineForgeTheme} path={path} value={content} onChange={(v) => onChange(v || "")} options={{ fontSize: 13, fontFamily: "JetBrains Mono, SFMono-Regular, Consolas, monospace", minimap: { enabled: false }, padding: { top: 18 }, smoothScrolling: true, scrollBeyondLastLine: false, renderLineHighlight: "line", automaticLayout: true }} />
    </div>
  );
}
