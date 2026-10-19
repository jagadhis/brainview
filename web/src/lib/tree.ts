import { dirname } from "../../../src/shared/paths.ts";
import type { ArtifactSummary, NoteListing } from "../../../src/shared/types.ts";

export interface TreeFolder {
  name: string;
  path: string;
  folders: TreeFolder[];
  notes: NoteListing[];
  artifacts: ArtifactSummary[];
  /** Notes in this folder and below; artifacts are listed but not counted. */
  count: number;
}

export function buildTree(notes: NoteListing[], artifacts: ArtifactSummary[] = []): TreeFolder {
  const root: TreeFolder = { name: "", path: "", folders: [], notes: [], artifacts: [], count: 0 };
  const index = new Map<string, TreeFolder>([["", root]]);
  const folderFor = (path: string): TreeFolder => {
    const existing = index.get(path);
    if (existing) return existing;
    const slash = path.lastIndexOf("/");
    const parent = folderFor(slash === -1 ? "" : path.slice(0, slash));
    const folder: TreeFolder = { name: path.slice(slash + 1), path, folders: [], notes: [], artifacts: [], count: 0 };
    parent.folders.push(folder);
    index.set(path, folder);
    return folder;
  };
  const countIn = (start: string) => {
    for (let f = start; ; f = f.includes("/") ? f.slice(0, f.lastIndexOf("/")) : "") {
      index.get(f)!.count++;
      if (f === "") break;
    }
  };
  for (const note of notes) {
    folderFor(note.folder).notes.push(note);
    countIn(note.folder);
  }
  for (const artifact of artifacts) folderFor(dirname(artifact.path)).artifacts.push(artifact);
  const sort = (folder: TreeFolder) => {
    folder.folders.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    folder.notes.sort((a, b) => indexFirst(a) - indexFirst(b) || a.path.localeCompare(b.path, undefined, { numeric: true }));
    folder.artifacts.sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true }));
    folder.folders.forEach(sort);
  };
  sort(root);
  return root;
}

function indexFirst(note: NoteListing): number {
  return /\/(readme|index|current)\.mdx?$|^(readme|index)\.mdx?$/i.test(note.path) ? 0 : 1;
}

export type TreeRow =
  | { kind: "folder"; path: string; parent: string; depth: number; folder: TreeFolder; open: boolean }
  | { kind: "note"; path: string; parent: string; depth: number; note: NoteListing }
  | { kind: "artifact"; path: string; parent: string; depth: number; artifact: ArtifactSummary };

/** The visible rows of the tree, in display order, descending only into expanded folders. */
export function flattenTree(root: TreeFolder, expanded: Set<string>): TreeRow[] {
  const rows: TreeRow[] = [];
  const walk = (folder: TreeFolder, depth: number) => {
    for (const child of folder.folders) {
      const open = expanded.has(child.path);
      rows.push({ kind: "folder", path: child.path, parent: folder.path, depth, folder: child, open });
      if (open) walk(child, depth + 1);
    }
    for (const note of folder.notes) rows.push({ kind: "note", path: note.path, parent: folder.path, depth, note });
    for (const artifact of folder.artifacts) rows.push({ kind: "artifact", path: artifact.path, parent: folder.path, depth, artifact });
  };
  walk(root, 0);
  return rows;
}
