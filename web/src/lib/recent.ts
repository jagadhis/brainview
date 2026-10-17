const KEY = "brainview:recent";

export function recentPaths(): string[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "[]") as string[];
  } catch {
    return [];
  }
}

export function rememberVisit(path: string): void {
  localStorage.setItem(KEY, JSON.stringify([path, ...recentPaths().filter((p) => p !== path)].slice(0, 30)));
}
