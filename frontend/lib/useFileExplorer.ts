"use client";

import { useMemo } from "react";
import { getParentPath, type TreeNode } from "@/lib/fileTree";
import type { FileNode } from "@/types/api";

interface UseExplorerArgs {
  tree: TreeNode[];
  files: FileNode[];
  expanded: Set<string>;
  selectedPath: string | null;
  onSelect: (path: string) => void;
  setSelectedPath: (path: string | null) => void;
  setExpanded: React.Dispatch<React.SetStateAction<Set<string>>>;
  setRenamingPath: (path: string | null) => void;
  onDelete: (path: string, name: string) => void;
}

export function useFileExplorer({
  tree, files, expanded, selectedPath, onSelect, setSelectedPath, setExpanded, setRenamingPath, onDelete,
}: UseExplorerArgs) {
  const visiblePaths = useMemo(() => {
    const list: { path: string; isDir: boolean }[] = [];
    if (!expanded.has("__project__")) return list;
    function walk(nodes: TreeNode[]) {
      for (const n of nodes) {
        list.push({ path: n.path, isDir: n.file_type === "DIRECTORY" });
        if (n.file_type === "DIRECTORY" && expanded.has(n.path)) walk(n.children);
      }
    }
    walk(tree);
    return list;
  }, [expanded, tree]);

  const resolveTargetParent = (path: string | null): string => {
    if (!path || path === "__project__") return "";
    const node = files.find((f) => f.path === path);
    return node?.file_type === "DIRECTORY" ? path : getParentPath(path);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "F2" && selectedPath) {
      e.preventDefault();
      setRenamingPath(selectedPath);
    } else if (e.key === "Delete" && selectedPath) {
      e.preventDefault();
      const node = files.find((f) => f.path === selectedPath);
      if (node) onDelete(selectedPath, selectedPath.split("/").pop() || selectedPath);
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const idx = visiblePaths.findIndex((p) => p.path === selectedPath);
      const nextIdx = e.key === "ArrowDown" ? Math.min(idx + 1, visiblePaths.length - 1) : Math.max(idx - 1, 0);
      if (visiblePaths[nextIdx]) {
        setSelectedPath(visiblePaths[nextIdx].path);
        if (!visiblePaths[nextIdx].isDir) onSelect(visiblePaths[nextIdx].path);
      }
    } else if (e.key === "ArrowRight" && selectedPath) {
      if (visiblePaths.find((p) => p.path === selectedPath)?.isDir) {
        setExpanded((p) => new Set(p).add(selectedPath));
      }
    } else if (e.key === "ArrowLeft" && selectedPath) {
      if (visiblePaths.find((p) => p.path === selectedPath)?.isDir) {
        setExpanded((p) => { const n = new Set(p); n.delete(selectedPath); return n; });
      }
    }
  };

  return { visiblePaths, resolveTargetParent, handleKeyDown };
}
