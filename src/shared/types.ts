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
  /** Other notes an ambiguous wiki link could mean. */
  alternatives?: string[];
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

export interface DeadLink {
  from: string;
  line: number;
  raw: string;
  kind: "markdown" | "wiki";
  /** A replacement for `raw` that resolves, when one is likely: a `../` level off, a unique file name, or a close title. */
  fix: { raw: string; target: string; reason: string } | null;
}

export interface HealthReport {
  deadLinks: DeadLink[];
  /** Wiki links whose name matches more than one note. */
  ambiguousLinks: { from: string; line: number; raw: string; target: string; alternatives: string[] }[];
  /** Notes nothing links to, not even through a linked index note of a folder above them. */
  orphans: string[];
  /** Notes with no direct link that sit under a folder whose index note (such as README.md) is linked. */
  reachedThroughFolder: string[];
  duplicateTitles: { title: string; paths: string[] }[];
  frontmatterErrors: { path: string; error: string }[];
  emptyNotes: string[];
  schemaIssues: { path: string; key: string; problem: string }[];
}

export interface FixLinkRequest {
  path: string;
  line: number;
  raw: string;
  replacement: string;
  baseHash: string;
}

export interface MoveRequest {
  from: string;
  to: string;
}

export interface MoveResponse {
  path: string;
  /** Other notes whose links were rewritten to follow the move. */
  updated: string[];
}

export interface DeleteResponse {
  trashId: string;
  /** Notes that still link to the deleted note. */
  linkedFrom: string[];
}

export interface Template {
  path: string;
  title: string;
}

export interface CreateRequest {
  path: string;
  content?: string;
  /** Vault path of a template note; its `{{title}}`, `{{date}}`, `{{time}}` and `{{path}}` are filled in. */
  template?: string;
  title?: string;
}

export interface HistoryEntry {
  rev: string;
  date: number;
  author: string;
  subject: string;
  /** The note's path at this commit, which differs after a rename. */
  path: string;
}

export interface RelatedNote {
  path: string;
  title: string;
  folder: string;
  reason: string;
}

export interface TagStat {
  tag: string;
  count: number;
  paths: string[];
}

export interface TimelineEntry {
  path: string;
  title: string;
  folder: string;
  date: number;
  /** "modified" for the file time, otherwise the frontmatter key the date came from. */
  source: string;
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

export type FieldKind = "text" | "enum" | "steps" | "date" | "list" | "number" | "boolean" | "link";

export interface FieldSchema {
  kind?: FieldKind;
  label?: string;
  /** Allowed values for an enum, or the step order for a steps field. */
  values?: string[];
  /** Badge colour per enum value: a CSS colour or one of the preset names. */
  colors?: Record<string, string>;
}

/** `.brainview.json` at the folder root. Every part is optional. */
export interface BrainConfig {
  fields: Record<string, FieldSchema>;
  /** Required keys for notes whose frontmatter `type` has this value. "*" applies to every note with frontmatter. */
  required: Record<string, string[]>;
  /** File names (without extension) that act as a folder's index note. */
  indexNames: string[];
  templatesFolder: string;
  dailyFolder: string;
  /** Daily note name pattern with YYYY, MM and DD. */
  dailyFormat: string;
  dailyTemplate: string | null;
  /** Frontmatter key that names a note's workstream or workstreams. */
  workstreamField: string;
  /** Configured workstreams, in display order. Names found only in the field are added after these. */
  workstreams: WorkstreamConfig[];
  /** Problems reading the config file, shown in Health. */
  errors: string[];
}

/** One workstream in `.brainview.json`. Only `name` is required. */
export interface WorkstreamConfig {
  name: string;
  /** Globs that assign notes with no stream field. Without a `/` a pattern matches the file name, with one the path. */
  match?: string[];
  /** A CSS colour or a preset name, as for enum fields. */
  color?: string;
  /** What belongs in the stream, written for people and agents. */
  description?: string;
  /** Where new instances go. Its index note is the stream's home, not an instance. */
  folder?: string;
  /** Path of a template note for new instances. */
  template?: string;
  /** Frontmatter keys every note in the stream must have; missing ones show in Health. */
  required?: string[];
}

/** One item of work: a note, or a folder represented by its index note together with the notes folded into it. */
export interface WorkstreamInstance {
  /** The representing note. */
  path: string;
  title: string;
  folder: string;
  kind: "note" | "folder";
  /** Notes in the instance, the representing note included. */
  notes: number;
  /** Newest modified time of any note in the instance. */
  updated: number;
  /** Frontmatter `status`, else `stage`, of the representing note. */
  status: string | null;
  /** Frontmatter `created`, else `date`, as epoch milliseconds. */
  created: number | null;
  /** The note's other streams, when it is in more than one. */
  alsoIn: string[];
}

export interface Workstream {
  name: string;
  color: string | null;
  description: string | null;
  folder: string | null;
  template: string | null;
  /** False for a stream that exists only because a note names it. */
  configured: boolean;
  instances: WorkstreamInstance[];
}

export interface WorkstreamsResponse {
  field: string;
  streams: Workstream[];
  unassigned: WorkstreamInstance[];
}

export type WorkstreamSort = "updated" | "status" | "title" | "created";

export interface StreamSuggestion {
  path: string;
  title: string;
  suggestions: { stream: string; score: number; reason: string }[];
}

export interface CreateWorkstreamRequest {
  name: string;
  description?: string;
  folder?: string;
  color?: string;
}

export interface VaultInfo {
  name: string;
  root: string;
  noteCount: number;
  readOnly: boolean;
  /** True in an exported static site: no writes, no AI, no live updates. */
  static?: boolean;
  config: BrainConfig;
  git: boolean;
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
  /** `links` is true when links, titles or the set of notes changed, so the graph and health need a refetch. */
  | { type: "changed"; paths: string[]; links: boolean }
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
  /**
   * The notes attached to each earlier user turn, one list per turn in `history`. Follow-ups resend them in the same
   * places, so they stay available to the answer and the request prefix stays cached.
   */
  previousSources?: string[][];
}

export interface AiUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
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
  | { type: "done"; stopReason: string | null; usage?: AiUsage }
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
  usage?: AiUsage;
}
