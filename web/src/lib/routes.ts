export function noteHref(path: string, anchor?: string): string {
  return `/note/${path.split("/").map(encodeURIComponent).join("/")}${anchor ? `#${anchor}` : ""}`;
}

export function pathFromRoute(wild: string | undefined): string | null {
  if (!wild) return null;
  return wild.split("/").map(decodeURIComponent).join("/");
}
