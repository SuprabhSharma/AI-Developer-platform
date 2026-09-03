"use client";

import React, { useEffect, useState } from "react";
import { isValidMoveTarget, type TreeNode } from "@/lib/fileTree";
import InlineInput from "./InlineInput";
import TreeNodeItem from "./TreeNodeItem";
import type { FileNode } from "@/types/api";

interface FileTreeRendererProps {
  nodes: TreeNode[];
  /** Path of the directory that directly contains `nodes` ("" for the workspace root). Passed explicitly
   * (never inferred from `nodes[0]`) so empty folders and single-child folders behave identically. */
  parentPath: string;
  depth: number;
  files: FileNode[];
  expanded: Set<string>;
  creating: { type: "file" | "folder"; parentPath: string } | null;
  renamingPath: string | null;
  busy: boolean;
  selectedPath: string | null;
  activePath: string | null;
  draggingNode: TreeNode | null;
  dragOverTarget: string | null;
  onToggle: (path: string) => void;
  onSelect: (path: string, isDirectory: boolean) => void;
  onContextMenu: (e: React.MouseEvent, node: TreeNode) => void;
  onDragStart: (e: React.DragEvent, node: TreeNode) => void;
  onDragEnd: () => void;
  onDragOver: (path: string) => void;
  onDragLeave: () => void;
  onDrop: (e: React.DragEvent, path: string) => void;
  onCreateSubmit: (name: string) => Promise<void>;
  onCreateCancel: () => void;
  onRenameSubmit: (name: string) => Promise<void>;
  onRenameCancel: () => void;
}

function FolderBranch({
  node,
  depth,
  isExp,
  children,
}: {
  node: TreeNode;
  depth: number;
  isExp: boolean;
  children: React.ReactNode;
}) {
  const [mounted, setMounted] = useState(isExp);

  useEffect(() => {
    if (isExp) setMounted(true);
  }, [isExp]);

  if (!mounted && !isExp) return null;

  return (
    <div className={`tree-folder-children ${isExp ? "tree-folder-expanded" : "tree-folder-collapsed"}`}>
      <div className="tree-folder-inner">
        {children}
      </div>
    </div>
  );
}

export default function FileTreeRenderer({
  nodes,
  parentPath,
  depth,
  files,
  expanded,
  creating,
  renamingPath,
  busy,
  selectedPath,
  activePath,
  draggingNode,
  dragOverTarget,
  onToggle,
  onSelect,
  onContextMenu,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDragLeave,
  onDrop,
  onCreateSubmit,
  onCreateCancel,
  onRenameSubmit,
  onRenameCancel,
}: FileTreeRendererProps) {
  return (
    <>
      {creating && creating.parentPath === parentPath && (
        <InlineInput
          type={creating.type}
          depth={depth}
          busy={busy}
          onSubmit={onCreateSubmit}
          onCancel={onCreateCancel}
        />
      )}
      {nodes.map((node) => {
        const isDir = node.file_type === "DIRECTORY";
        const isExp = expanded.has(node.path);

        if (renamingPath === node.path) {
          return (
            <InlineInput
              key={node.path}
              type="rename"
              initialValue={node.name}
              depth={depth}
              busy={busy}
              onSubmit={onRenameSubmit}
              onCancel={onRenameCancel}
            />
          );
        }

        return (
          <React.Fragment key={node.path}>
            <TreeNodeItem
              node={node}
              depth={depth}
              isExpanded={isExp}
              isSelected={selectedPath === node.path}
              isActive={activePath === node.path}
              isDropTarget={dragOverTarget === node.path}
              isDragging={draggingNode?.path === node.path}
              onToggle={onToggle}
              onSelect={onSelect}
              onContextMenu={onContextMenu}
              onDragStart={onDragStart}
              onDragEnd={onDragEnd}
              onDragOver={(e) => {
                if (
                  draggingNode &&
                  isDir &&
                  isValidMoveTarget(draggingNode.path, draggingNode.file_type === "DIRECTORY", node.path, files)
                ) {
                  e.preventDefault();
                  onDragOver(node.path);
                }
              }}
              onDragLeave={onDragLeave}
              onDrop={(e) => onDrop(e, node.path)}
            />
            {isDir && (
              <FolderBranch node={node} depth={depth} isExp={isExp}>
                <FileTreeRenderer
                  nodes={node.children}
                  parentPath={node.path}
                  depth={depth + 1}
                  files={files}
                  expanded={expanded}
                  creating={creating}
                  renamingPath={renamingPath}
                  busy={busy}
                  selectedPath={selectedPath}
                  activePath={activePath}
                  draggingNode={draggingNode}
                  dragOverTarget={dragOverTarget}
                  onToggle={onToggle}
                  onSelect={onSelect}
                  onContextMenu={onContextMenu}
                  onDragStart={onDragStart}
                  onDragEnd={onDragEnd}
                  onDragOver={onDragOver}
                  onDragLeave={onDragLeave}
                  onDrop={onDrop}
                  onCreateSubmit={onCreateSubmit}
                  onCreateCancel={onCreateCancel}
                  onRenameSubmit={onRenameSubmit}
                  onRenameCancel={onRenameCancel}
                />
              </FolderBranch>
            )}
          </React.Fragment>
        );
      })}
    </>
  );
}
