import type { FileNode } from "@/types/api";

export interface TreeNode {
  path: string;
  name: string;
  file_type: "FILE" | "DIRECTORY";
  size_bytes: number;
  children: TreeNode[];
  synthetic?: boolean;
}

export interface FlatTreeItem {
  id: string;
  path: string;
  name: string;
  file_type: "FILE" | "DIRECTORY";
  depth: number;
  isProjectRoot?: boolean;
  isMainRoot?: boolean;
  node?: TreeNode;
}

export function sortTreeNodes(nodes: TreeNode[]): TreeNode[] {
  nodes.sort((a, b) => {
    const aIsDir = a.file_type === "DIRECTORY";
    const bIsDir = b.file_type === "DIRECTORY";
    if (aIsDir !== bIsDir) return aIsDir ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
  });
  for (const node of nodes) {
    if (node.children.length > 0) {
      sortTreeNodes(node.children);
    }
  }
  return nodes;
}

export function buildTree(files: FileNode[]): TreeNode[] {
  const rootChildren: TreeNode[] = [];
  const dirMap = new Map<string, TreeNode>();

  for (const file of files) {
    const cleanPath = file.path.trim().replace(/^\/+|\/+$/g, "");
    if (!cleanPath) continue;

    const parts = cleanPath.split("/");
    let currentPath = "";

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isLeaf = i === parts.length - 1;
      currentPath = currentPath ? `${currentPath}/${part}` : part;

      let existing = dirMap.get(currentPath);
      if (!existing) {
        const newNode: TreeNode = {
          path: currentPath,
          name: part,
          file_type: isLeaf ? file.file_type : "DIRECTORY",
          size_bytes: isLeaf ? file.size_bytes : 0,
          children: [],
          synthetic: !isLeaf && file.file_type !== "DIRECTORY",
        };
        dirMap.set(currentPath, newNode);

        if (i === 0) {
          rootChildren.push(newNode);
        } else {
          const parentPath = currentPath.substring(0, currentPath.lastIndexOf("/"));
          const parentNode = dirMap.get(parentPath);
          if (parentNode) {
            parentNode.children.push(newNode);
          }
        }
      } else if (isLeaf) {
        existing.file_type = file.file_type;
        existing.size_bytes = file.size_bytes;
        existing.synthetic = false;
      }
    }
  }

  return sortTreeNodes(rootChildren);
}

export function getParentPath(path: string): string {
  const clean = path.trim().replace(/^\/+|\/+$/g, "");
  const lastSlash = clean.lastIndexOf("/");
  return lastSlash >= 0 ? clean.slice(0, lastSlash) : "";
}

export function getFileExtension(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot >= 0 ? filename.slice(dot + 1).toLowerCase() : "";
}

export function isValidMoveTarget(
  draggedPath: string,
  isDraggedDir: boolean,
  targetDirPath: string,
  allFiles: FileNode[]
): boolean {
  if (draggedPath === targetDirPath) return false;

  const draggedName = draggedPath.includes("/")
    ? draggedPath.slice(draggedPath.lastIndexOf("/") + 1)
    : draggedPath;

  const newTargetChildPath = targetDirPath ? `${targetDirPath}/${draggedName}` : draggedName;

  // Moving to same location is a no-op
  if (newTargetChildPath === draggedPath) return false;

  // Cannot move directory into descendant
  if (isDraggedDir) {
    if (targetDirPath === draggedPath || targetDirPath.startsWith(`${draggedPath}/`)) {
      return false;
    }
  }

  // Target path already exists
  if (allFiles.some((f) => f.path === newTargetChildPath)) {
    return false;
  }

  return true;
}
