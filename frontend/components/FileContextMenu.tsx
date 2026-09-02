"use client";

import { useEffect, useRef } from "react";
import Icon from "@/components/Icon";

export interface ContextMenuTarget {
  path: string;
  name: string;
  file_type: "FILE" | "DIRECTORY";
  isRoot?: boolean;
  isMain?: boolean;
}

interface FileContextMenuProps {
  x: number;
  y: number;
  target: ContextMenuTarget;
  onClose: () => void;
  onNewFile?: (parentPath: string) => void;
  onNewFolder?: (parentPath: string) => void;
  onRename?: (path: string, currentName: string) => void;
  onDelete?: (path: string, name: string) => void;
  onOpen?: (path: string) => void;
  onExplainFile?: (path: string) => void;
  onGenerateTests?: (path: string) => void;
}

export default function FileContextMenu({
  x,
  y,
  target,
  onClose,
  onNewFile,
  onNewFolder,
  onRename,
  onDelete,
  onOpen,
  onExplainFile,
  onGenerateTests,
}: FileContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    function handlePointerDown(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("pointerdown", handlePointerDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [onClose]);

  // Adjust for viewport boundary
  const adjustedX = Math.min(x, typeof window !== "undefined" ? window.innerWidth - 180 : x);
  const adjustedY = Math.min(y, typeof window !== "undefined" ? window.innerHeight - 240 : y);

  const isFile = target.file_type === "FILE";
  const canModify = !target.isRoot && !target.isMain;

  return (
    <div
      ref={menuRef}
      className="context-menu"
      style={{ left: `${adjustedX}px`, top: `${adjustedY}px` }}
      onClick={(e) => e.stopPropagation()}
    >
      {isFile ? (
        <>
          <button
            type="button"
            onClick={() => {
              onOpen?.(target.path);
              onClose();
            }}
          >
            <Icon name="file" size={13} /> Open
          </button>
          <div className="context-menu-divider" />
          <button
            type="button"
            onClick={() => {
              onRename?.(target.path, target.name);
              onClose();
            }}
          >
            <Icon name="code" size={13} /> Rename
          </button>
          <button
            type="button"
            className="context-danger"
            onClick={() => {
              onDelete?.(target.path, target.name);
              onClose();
            }}
          >
            <Icon name="trash" size={13} /> Delete
          </button>
          {(onExplainFile || onGenerateTests) && <div className="context-menu-divider" />}
          {onExplainFile && (
            <button
              type="button"
              onClick={() => {
                onExplainFile(target.path);
                onClose();
              }}
            >
              <Icon name="sparkle" size={13} /> Explain this code
            </button>
          )}
          {onGenerateTests && (
            <button
              type="button"
              onClick={() => {
                onGenerateTests(target.path);
                onClose();
              }}
            >
              <Icon name="check" size={13} /> Generate tests
            </button>
          )}
        </>
      ) : (
        <>
          <button
            type="button"
            onClick={() => {
              onNewFile?.(target.path);
              onClose();
            }}
          >
            <Icon name="plus" size={13} /> New File
          </button>
          <button
            type="button"
            onClick={() => {
              onNewFolder?.(target.path);
              onClose();
            }}
          >
            <Icon name="folder-plus" size={13} /> New Folder
          </button>
          {canModify && (
            <>
              <div className="context-menu-divider" />
              <button
                type="button"
                onClick={() => {
                  onRename?.(target.path, target.name);
                  onClose();
                }}
              >
                <Icon name="code" size={13} /> Rename
              </button>
              <button
                type="button"
                className="context-danger"
                onClick={() => {
                  onDelete?.(target.path, target.name);
                  onClose();
                }}
              >
                <Icon name="trash" size={13} /> Delete
              </button>
            </>
          )}
        </>
      )}
    </div>
  );
}
