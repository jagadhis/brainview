// Vault paths are POSIX-style and relative to the vault root, in the server and the browser alike.

export function normalizePath(path: string): string {
  const out: string[] = [];
  for (const part of path.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (out.length > 0 && out[out.length - 1] !== "..") out.pop();
      else out.push("..");
      continue;
    }
    out.push(part);
  }
  return out.join("/");
}

export function dirname(path: string): string {
  const i = path.lastIndexOf("/");
  return i === -1 ? "" : path.slice(0, i);
}

export function basename(path: string): string {
  const i = path.lastIndexOf("/");
  return i === -1 ? path : path.slice(i + 1);
}

export function stripExtension(name: string): string {
  return name.replace(/\.(md|mdx|markdown)$/i, "");
}

export function isNotePath(path: string): boolean {
  return /\.(md|mdx|markdown)$/i.test(path);
}

export function joinPath(dir: string, rel: string): string {
  return normalizePath(dir ? `${dir}/${rel}` : rel);
}

export function isOutsideVault(path: string): boolean {
  return path === ".." || path.startsWith("../");
}

/** Relative link from one note to another, as a Markdown author would write it. */
export function relativePath(from: string, to: string): string {
  const fromParts = dirname(from).split("/").filter(Boolean);
  const toParts = to.split("/");
  let common = 0;
  while (common < fromParts.length && common < toParts.length - 1 && fromParts[common] === toParts[common]) common++;
  const ups = fromParts.length - common;
  return [...Array(ups).fill(".."), ...toParts.slice(common)].join("/") || basename(to);
}
