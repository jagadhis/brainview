import type { Mount } from "../../../src/shared/types.ts";
import { normalizePath } from "../../../src/shared/paths.ts";

export function noteHref(path: string, anchor?: string): string {
  return `/note/${path.split("/").map(encodeURIComponent).join("/")}${anchor ? `#${anchor}` : ""}`;
}

export function pathFromRoute(wild: string | undefined): string | null {
  if (!wild) return null;
  return wild.split("/").map(decodeURIComponent).join("/");
}

const encodePath = (path: string) => path.split("/").map(encodeURIComponent).join("/");

export function artifactHref(path: string): string {
  return `/artifact/${encodePath(path)}`;
}

/** Raw file URL. Path-style, so relative references inside an HTML artifact resolve beside it. */
export function fileUrl(path: string): string {
  return `/files/${encodePath(path)}`;
}

/**
 * URL of a file outside the vault, or null unless it sits in a folder allowed with --allow.
 * `target` is vault-relative (starting with ../) or an absolute filesystem path.
 */
export function mountedFileUrl(target: string, root: string, mounts: Mount[]): string | null {
  const absolute = `/${normalizePath(target.startsWith("/") ? target : `${root}/${target}`)}`;
  for (const mount of mounts) {
    if (absolute.startsWith(`${mount.root}/`)) return `/mounts/${encodeURIComponent(mount.name)}/${encodePath(absolute.slice(mount.root.length + 1))}`;
  }
  return null;
}
