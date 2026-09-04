import type { UploadEntry } from "@/components/FileExplorer";

/** Join a base directory (possibly "") with a relative path, VS-Code-explorer style. */
function joinPath(base: string, relative: string): string {
  const cleanRelative = relative.replace(/^\/+/, "");
  return base ? `${base}/${cleanRelative}` : cleanRelative;
}

/**
 * Build upload entries from a plain <input type="file" [webkitdirectory]> FileList.
 * For a directory input, each File carries `webkitRelativePath` (e.g. "myFolder/src/index.ts"),
 * which already includes the imported folder's own name as the first segment.
 */
export function entriesFromFileList(fileList: FileList, targetDir: string): UploadEntry[] {
  const entries: UploadEntry[] = [];
  for (let i = 0; i < fileList.length; i++) {
    const file = fileList[i];
    const relative = file.webkitRelativePath && file.webkitRelativePath.length > 0 ? file.webkitRelativePath : file.name;
    entries.push({ file, path: joinPath(targetDir, relative) });
  }
  return entries;
}

export interface DroppedImport {
  entries: UploadEntry[];
  /** Folders that contain no files anywhere in their subtree, so they need to be created explicitly. */
  directories: string[];
}

/**
 * Recursively read every file out of a dropped OS file/folder DataTransfer, preserving folder structure,
 * so dragging a folder from the desktop onto the explorer imports it exactly like VS Code does.
 * Empty folders are tracked separately (a plain file list has no concept of an empty folder) so they
 * still show up in the tree instead of silently vanishing, matching VS Code's import behavior.
 * Falls back to a flat file list on browsers without the (non-standard but broadly supported) entries API.
 */
export async function entriesFromDataTransfer(dataTransfer: DataTransfer, targetDir: string): Promise<DroppedImport> {
  const items = dataTransfer.items;
  const supportsEntries = !!items && items.length > 0 && typeof items[0]?.webkitGetAsEntry === "function";

  if (!supportsEntries) {
    return { entries: entriesFromFileList(dataTransfer.files, targetDir), directories: [] };
  }

  type FSEntry = {
    isFile: boolean;
    isDirectory: boolean;
    name: string;
    file: (cb: (f: File) => void, err: (e: unknown) => void) => void;
    createReader: () => { readEntries: (cb: (e: FSEntry[]) => void, err: (e: unknown) => void) => void };
  };

  const readEntryFile = (entry: FSEntry): Promise<File> =>
    new Promise((resolve, reject) => entry.file(resolve, reject));

  const readAllDirectoryEntries = (entry: FSEntry): Promise<FSEntry[]> => {
    const reader = entry.createReader();
    const all: FSEntry[] = [];
    const readBatch = (): Promise<FSEntry[]> =>
      new Promise((resolve, reject) => reader.readEntries(resolve, reject));
    // readEntries must be called repeatedly until it returns an empty array.
    const loop = async (): Promise<FSEntry[]> => {
      const batch = await readBatch();
      if (batch.length === 0) return all;
      all.push(...batch);
      return loop();
    };
    return loop();
  };

  const collected: UploadEntry[] = [];
  const emptyDirectories: string[] = [];

  const walk = async (entry: FSEntry, relativePath: string): Promise<void> => {
    if (entry.isFile) {
      const file = await readEntryFile(entry);
      collected.push({ file, path: joinPath(targetDir, relativePath) });
    } else if (entry.isDirectory) {
      const children = await readAllDirectoryEntries(entry);
      if (children.length === 0) {
        emptyDirectories.push(joinPath(targetDir, relativePath));
        return;
      }
      await Promise.all(children.map((child) => walk(child, `${relativePath}/${child.name}`)));
    }
  };

  const roots: FSEntry[] = [];
  for (let i = 0; i < items.length; i++) {
    const entry = items[i]?.webkitGetAsEntry?.() as FSEntry | null;
    if (entry) roots.push(entry);
  }

  await Promise.all(roots.map((entry) => walk(entry, entry.name)));
  return { entries: collected, directories: emptyDirectories };
}
