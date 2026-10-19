import { dirname } from "../../../src/shared/paths.ts";
import type { ArtifactSummary, BrainConfig, NoteListing, WorkstreamInstance, WorkstreamSort, WorkstreamsResponse } from "../../../src/shared/types.ts";
import { sortInstances } from "../../../src/shared/workstreams.ts";

export interface TreeFolder {
  name: string;
  path: string;
  folders: TreeFolder[];
  notes: NoteListing[];
  artifacts: ArtifactSummary[];
  /** Notes in this folder and below; artifacts are listed but not counted. */
  count: number;
  /** Set on a folder of the stream tree, which holds a stream's instances rather than a directory. */
  stream?: StreamFolder;
}

export interface StreamFolder {
  color: string | null;
  /** Place among the streams, for a default colour. */
  order: number;
  /** The other streams of each shared note, by path. */
  alsoIn: Map<string, string[]>;
}

// No vault path can contain NUL, so stream folders (and Unassigned) never share a path, or saved expansion, with a real folder.
const STREAM_PATH = "\0stream:";
export const UNASSIGNED = "Unassigned";

/** Instance rows only carry what the stream answer has; the sidebar row needs no more than path, title and folder. */
function instanceListing(instance: WorkstreamInstance): NoteListing {
  return {
    path: instance.path,
    title: instance.title,
    folder: instance.folder,
    kind: instance.path.endsWith(".mdx") ? "mdx" : "md",
    size: 0,
    mtime: instance.updated,
    words: 0,
    frontmatterError: null,
    tags: [],
    generated: false,
    inbound: 0,
    outbound: 0,
  };
}

/** One folder per stream, in the server's order, then Unassigned when it has notes. Instances are the rows. */
export function buildStreamTree(data: WorkstreamsResponse, sort: WorkstreamSort, config: BrainConfig): TreeFolder {
  const folder = (name: string, path: string, instances: WorkstreamInstance[], stream: Omit<StreamFolder, "alsoIn">): TreeFolder => ({
    name,
    path,
    folders: [],
    notes: sortInstances(instances, sort, config).map(instanceListing),
    artifacts: [],
    count: instances.length,
    stream: { ...stream, alsoIn: new Map(instances.filter((i) => i.alsoIn.length).map((i) => [i.path, i.alsoIn])) },
  });
  const folders = data.streams.map((s, order) => folder(s.name, `${STREAM_PATH}${s.name}`, s.instances, { color: s.color, order }));
  if (data.unassigned.length) folders.push(folder(UNASSIGNED, "\0unassigned", data.unassigned, { color: "gray", order: folders.length }));
  return { name: "", path: "", folders, notes: [], artifacts: [], count: folders.reduce((n, f) => n + f.count, 0) };
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
  | { kind: "note"; path: string; parent: string; depth: number; note: NoteListing; alsoIn?: string[] }
  | { kind: "artifact"; path: string; parent: string; depth: number; artifact: ArtifactSummary };

/**
 * The visible rows of the tree, in display order, descending only into expanded folders. A note can sit in several
 * stream folders, so its row there is keyed under the folder; `note.path` is always the note's own path.
 */
export function flattenTree(root: TreeFolder, expanded: Set<string>): TreeRow[] {
  const rows: TreeRow[] = [];
  const walk = (folder: TreeFolder, depth: number) => {
    for (const child of folder.folders) {
      const open = expanded.has(child.path);
      rows.push({ kind: "folder", path: child.path, parent: folder.path, depth, folder: child, open });
      if (open) walk(child, depth + 1);
    }
    for (const note of folder.notes) {
      const path = folder.stream ? `${folder.path}\0${note.path}` : note.path;
      rows.push({ kind: "note", path, parent: folder.path, depth, note, alsoIn: folder.stream?.alsoIn.get(note.path) });
    }
    for (const artifact of folder.artifacts) rows.push({ kind: "artifact", path: artifact.path, parent: folder.path, depth, artifact });
  };
  walk(root, 0);
  return rows;
}
