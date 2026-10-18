import { dirname } from "../../../src/shared/paths.ts";
import type { ArtifactSummary, NoteListing } from "../../../src/shared/types.ts";

export interface TreeFolder {
  name: string;
  path: string;
  folders: TreeFolder[];
  notes: NoteListing[];
  artifacts: ArtifactSummary[];
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
  for (const artifact of artifacts) {
    folderFor(dirname(artifact.path)).artifacts.push(artifact);
    countIn(dirname(artifact.path));
  }
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
