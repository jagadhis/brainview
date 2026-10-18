// Excalidraw imports this only for its Mermaid dialog and Mermaid paste, which brainview never shows. The real package
// bundles a second copy of Mermaid, so the build aliases it here (web/vite.config.ts).
export async function parseMermaidToExcalidraw(): Promise<never> {
  throw new Error("Mermaid to Excalidraw is not available in brainview");
}
