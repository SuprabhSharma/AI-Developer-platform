"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { FileNode } from "@/types/api";
import Icon, { type IconName } from "@/components/Icon";

interface CommandPaletteProps {
  files?: FileNode[];
  onOpenFile?: (path: string) => void;
  onNewFile?: () => void;
  onNewProject?: () => void;
  onToggleChat?: () => void;
}

type PaletteItem = { id: string; label: string; hint: string; shortcut?: string; icon: IconName; action: () => void; kind?: "file" | "action" };

export default function CommandPalette({ files = [], onOpenFile, onNewFile, onNewProject, onToggleChat }: CommandPaletteProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function handleShortcut(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((value) => !value);
      }
      if (event.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, []);

  useEffect(() => {
    if (open) {
      setQuery("");
      setSelected(0);
      window.setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  const items = useMemo<PaletteItem[]>(() => {
    const actions: PaletteItem[] = [
      ...(onNewFile ? [{ id: "new-file", label: "New file", hint: "Create a blank file", shortcut: "N", icon: "file" as IconName, action: onNewFile }] : []),
      ...(onNewProject ? [{ id: "new-project", label: "New project", hint: "Start a fresh workspace", shortcut: "P", icon: "plus" as IconName, action: onNewProject }] : []),
      ...(onToggleChat ? [{ id: "toggle-chat", label: "Toggle chat panel", hint: "Show or hide the assistant", shortcut: "C", icon: "sparkle" as IconName, action: onToggleChat }] : []),
    ];
    const fileItems = files.filter((file) => file.file_type === "FILE").map((file) => ({
      id: `file-${file.path}`,
      label: file.path,
      hint: "Open file",
      icon: "file" as IconName,
      action: () => onOpenFile?.(file.path),
      kind: "file" as const,
    }));
    return [...actions, ...fileItems];
  }, [files, onNewFile, onNewProject, onOpenFile, onToggleChat]);

  const filteredItems = items.filter((item) => `${item.label} ${item.hint}`.toLowerCase().includes(query.toLowerCase()));

  function run(item: PaletteItem) {
    item.action();
    setOpen(false);
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") { event.preventDefault(); setSelected((value) => Math.min(value + 1, Math.max(filteredItems.length - 1, 0))); }
    if (event.key === "ArrowUp") { event.preventDefault(); setSelected((value) => Math.max(value - 1, 0)); }
    if (event.key === "Enter" && filteredItems[selected]) { event.preventDefault(); run(filteredItems[selected]); }
  }

  return open ? (
    <div className="palette-backdrop" role="presentation" onMouseDown={() => setOpen(false)}>
      <section className="command-palette" role="dialog" aria-modal="true" aria-label="Command palette" onMouseDown={(event) => event.stopPropagation()}>
        <div className="palette-search-row"><Icon name="search" size={18} /><input ref={inputRef} value={query} onChange={(event) => { setQuery(event.target.value); setSelected(0); }} onKeyDown={handleKeyDown} placeholder="Search files and commands" aria-label="Search files and commands" /><kbd>Esc</kbd></div>
        <div className="palette-results">
          {filteredItems.length === 0 && <div className="palette-empty"><Icon name="search" size={20} /><p>No matching commands or files</p></div>}
          {filteredItems.map((item, index) => (
            <button type="button" key={item.id} className={`palette-item ${selected === index ? "palette-item-selected" : ""}`} onMouseEnter={() => setSelected(index)} onClick={() => run(item)}>
              <span className="palette-item-icon"><Icon name={item.icon} size={16} /></span><span className="palette-item-copy"><strong>{item.label}</strong><small>{item.hint}</small></span>{item.shortcut && <kbd>{item.shortcut}</kbd>}{item.kind === "file" && <Icon name="arrow-right" size={14} />}
            </button>
          ))}
        </div>
        <footer className="palette-footer"><span><kbd>↑</kbd><kbd>↓</kbd> Navigate</span><span><kbd>↵</kbd> Open</span><span><kbd>Esc</kbd> Close</span></footer>
      </section>
    </div>
  ) : null;
}
