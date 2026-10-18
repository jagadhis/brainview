export type ArtifactKind = "image" | "html" | "pdf" | "video" | "audio" | "mermaid" | "graphviz" | "excalidraw";

const KINDS: Record<string, ArtifactKind> = {
  png: "image",
  jpg: "image",
  jpeg: "image",
  gif: "image",
  webp: "image",
  avif: "image",
  svg: "image",
  html: "html",
  htm: "html",
  pdf: "pdf",
  mp4: "video",
  webm: "video",
  mov: "video",
  mp3: "audio",
  wav: "audio",
  ogg: "audio",
  m4a: "audio",
  mmd: "mermaid",
  dot: "graphviz",
  gv: "graphviz",
  excalidraw: "excalidraw",
};

/** The artifact kind a file renders as, or null when brainview shows it only as a link. */
export function artifactKind(path: string): ArtifactKind | null {
  const ext = /\.([a-z0-9]+)$/i.exec(path)?.[1]?.toLowerCase();
  return ext ? (KINDS[ext] ?? null) : null;
}
