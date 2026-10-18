import type { ArtifactKind } from "./artifacts.ts";
export type Frontmatter = Record<string, unknown>;

export interface NoteSummary {
  path: string;
  title: string;
  folder: string;
  kind: "md" | "mdx";
  size: number;
  mtime: number;
  words: number;
  frontmatter: Frontmatter | null;
  frontmatterError: string | null;
  tags: string[];
  generated: boolean;
  inbound: number;
  outbound: number;
}

/** A note in the brain-wide list. Frontmatter is left out because only the table needs it, and it is most of the size. */
export type NoteListing = Omit<NoteSummary, "frontmatter">;

export interface Heading {
  depth: number;
  text: string;
  slug: string;
  line: number;
}

export type LinkStatus = "note" | "file" | "outside" | "dead";

export interface OutgoingLink {
  raw: string;
  text: string;
  line: number;
  kind: "markdown" | "wiki";
  status: LinkStatus;
  target: string | null;
}

export interface Backlink {
  path: string;
  title: string;
  line: number;
  context: string;
}

export interface NoteDetail extends NoteSummary {
  content: string;
  hash: string;
  headings: Heading[];
  outgoing: OutgoingLink[];
  backlinks: Backlink[];
}

export interface GraphNode {
  id: string;
  title: string;
  folder: string;
  degree: number;
}

export interface GraphData {
  nodes: GraphNode[];
  links: { source: string; target: string }[];
}

export interface SearchHit {
  path: string;
  title: string;
  folder: string;
  score: number;
  snippet: string;
}

export interface HealthReport {
  deadLinks: { from: string; line: number; raw: string }[];
  orphans: string[];
  duplicateTitles: { title: string; paths: string[] }[];
  frontmatterErrors: { path: string; error: string }[];
  emptyNotes: string[];
}

export interface FolderStat {
  folder: string;
  notes: number;
  words: number;
  lastModified: number;
}

export interface FieldStat {
  key: string;
  count: number;
  values: { value: string; count: number }[];
}

export interface Overview {
  folders: FolderStat[];
  recent: NoteSummary[];
  stale: NoteSummary[];
  hubs: NoteSummary[];
  fields: FieldStat[];
  totals: { notes: number; words: number; links: number; deadLinks: number };
}

export interface VaultInfo {
  name: string;
  root: string;
  noteCount: number;
  readOnly: boolean;
  ai: AiStatus;
  /** Folders outside the vault that were allowed with --allow, served read-only under /mounts/<name>/. */
  mounts: Mount[];
}

export interface Mount {
  name: string;
  root: string;
}

export interface ArtifactSummary {
  path: string;
  kind: ArtifactKind;
  size: number;
  mtime: number;
}

export interface AiStatus {
  available: boolean;
  model: string;
  reason: string | null;
}

export type VaultEvent =
  | { type: "changed"; paths: string[] }
  | { type: "ready" };

export interface SaveRequest {
  path: string;
  content: string;
  baseHash: string | null;
}

export interface SaveResponse {
  hash: string;
  mtime: number;
}

export interface ConflictResponse {
  error: "conflict";
  hash: string;
  content: string;
}

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

export interface AskRequest {
  question: string;
  history: ChatTurn[];
  contextPath: string | null;
}

export interface AskSource {
  index: number;
  path: string;
  title: string;
  excerpted: boolean;
}

export interface AskCitation {
  documentIndex: number;
  citedText: string;
}

export type AskEvent =
  | { type: "sources"; sources: AskSource[] }
  | { type: "block" }
  | { type: "text"; text: string }
  | { type: "citation"; citation: AskCitation }
  | { type: "done"; stopReason: string | null }
  | { type: "error"; message: string };

export type AssistAction = "improve" | "shorten" | "expand" | "fix" | "summarize" | "continue" | "custom";

export interface AssistRequest {
  path: string;
  action: AssistAction;
  instruction: string | null;
  selection: string;
  before: string;
  after: string;
}

export interface Suggestions {
  summary: string;
  tags: string[];
  related: { path: string; title: string; reason: string }[];
  frontmatter: { key: string; value: string; reason: string }[];
}
