"use client";

import React, { memo } from "react";
import Icon from "@/components/Icon";
import { getFileExtension, type TreeNode } from "@/lib/fileTree";

interface TreeNodeItemProps {
  node: TreeNode;
  depth: number;
  isExpanded: boolean;
  isSelected: boolean;
  isActive: boolean;
  isDropTarget: boolean;
  isDragging: boolean;
  onToggle: (path: string) => void;
  onSelect: (path: string, isDirectory: boolean) => void;
  onContextMenu: (e: React.MouseEvent, node: TreeNode) => void;
  onDragStart: (e: React.DragEvent, node: TreeNode) => void;
  onDragEnd: () => void;
  onDragOver: (e: React.DragEvent, node: TreeNode) => void;
  onDragLeave: (e: React.DragEvent, node: TreeNode) => void;
  onDrop: (e: React.DragEvent, node: TreeNode) => void;
}

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
    case "png":
    case "jpg":
    case "svg":
      return "text-pink-400";
    default:
      return "text-slate-400";
  }
}

export const TreeNodeItem = memo(function TreeNodeItem({
  node,
  depth,
  isExpanded,
  isSelected,
  isActive,
  isDropTarget,
  isDragging,
  onToggle,
  onSelect,
  onContextMenu,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDragLeave,
  onDrop,
}: TreeNodeItemProps) {
  const isDirectory = node.file_type === "DIRECTORY";
  const iconColor = isDirectory ? "text-amber-300" : getFileIconColorClass(node.name);

  // Selection states:
  // 1. isSelected && isActive: clicked & open in editor -> full active row
  // 2. isSelected && !isActive: clicked item (e.g. folder or another file) -> prominent selection
  // 3. !isSelected && isActive: file open in editor but user clicked elsewhere -> subtle editor marker only!
  const rowClasses = [
    "tree-row",
    isSelected && isActive ? "tree-row-active" : "",
    isSelected && !isActive ? "tree-row-selected" : "",
    !isSelected && isActive ? "tree-row-editor-active" : "",
    isDropTarget ? "tree-row-drop-target" : "",
    isDragging ? "tree-row-dragging" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      className={rowClasses}
      style={{ paddingLeft: `${14 + depth * 14}px` }}
      draggable
      onDragStart={(e) => onDragStart(e, node)}
      onDragEnd={onDragEnd}
      onDragOver={(e) => onDragOver(e, node)}
      onDragLeave={(e) => onDragLeave(e, node)}
      onDrop={(e) => onDrop(e, node)}
      onClick={(e) => {
        e.stopPropagation();
        onSelect(node.path, isDirectory);
      }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        if (isDirectory) onToggle(node.path);
      }}
      onContextMenu={(e) => onContextMenu(e, node)}
      role="treeitem"
      aria-selected={isSelected}
      aria-expanded={isDirectory ? isExpanded : undefined}
    >
      {/* Visual indentation guides */}
      {depth > 0 &&
        Array.from({ length: depth }).map((_, i) => (
          <span
            key={i}
            className="tree-indent-guide"
            style={{ left: `${14 + i * 14 + 7}px` }}
            aria-hidden="true"
          />
        ))}

      <span
        className={`tree-chevron ${isExpanded ? "tree-chevron-expanded" : ""}`}
        onClick={(e) => {
          if (isDirectory) {
            e.stopPropagation();
            onToggle(node.path);
          }
        }}
      >
        {isDirectory ? (
          <Icon name="chevron-right" size={13} />
        ) : (
          <span className="w-[13px] inline-block" />
        )}
      </span>

      <span className={`tree-file-icon ${iconColor}`}>
        <Icon
          name={isDirectory ? (isExpanded ? "folder-open" : "folder") : "file"}
          size={14}
        />
      </span>

      <span className="tree-node-name truncate" title={node.path}>
        {node.name}
      </span>

      {isActive && (
        <span
          className={`tree-active-pill ${isSelected ? "tree-active-pill-selected" : "tree-active-pill-subtle"}`}
          title="Active in editor"
          aria-hidden="true"
        />
      )}
    </div>
  );
});

export default TreeNodeItem;
