"use client";

import { useEffect, useRef, useState } from "react";
import Icon from "@/components/Icon";

interface InlineInputProps {
  type: "file" | "folder" | "rename";
  initialValue?: string;
  depth: number;
  busy?: boolean;
  onSubmit: (value: string) => Promise<void> | void;
  onCancel: () => void;
}

export default function InlineInput({
  type,
  initialValue = "",
  depth,
  busy = false,
  onSubmit,
  onCancel,
}: InlineInputProps) {
  const [value, setValue] = useState(initialValue);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.focus();

    if (type === "rename" && initialValue) {
      const dotIndex = initialValue.lastIndexOf(".");
      if (dotIndex > 0) {
        input.setSelectionRange(0, dotIndex);
      } else {
        input.select();
      }
    } else {
      input.select();
    }
  }, [type, initialValue]);

  function handleKeyDown(event: React.KeyboardEvent) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onCancel();
    }
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = value.trim();
    if (!trimmed || busy) return;
    await onSubmit(trimmed);
  }

  const isFolder = type === "folder" || (type === "rename" && !initialValue.includes("."));

  return (
    <form
      className="tree-inline-input-row"
      style={{ paddingLeft: `${14 + depth * 14}px` }}
      onSubmit={handleSubmit}
      onClick={(e) => e.stopPropagation()}
    >
      <span className="tree-chevron-placeholder" />
      <span className={`tree-file-icon ${isFolder ? "tree-folder-icon" : ""}`}>
        <Icon name={isFolder ? "folder" : "file"} size={14} />
      </span>
      <input
        ref={inputRef}
        className="tree-inline-input"
        value={value}
        disabled={busy}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={() => {
          if (!busy && !value.trim()) {
            onCancel();
          }
        }}
        placeholder={type === "file" ? "file.ts" : type === "folder" ? "folder" : ""}
        aria-label={type === "rename" ? "Rename item" : `New ${type}`}
      />
    </form>
  );
}
