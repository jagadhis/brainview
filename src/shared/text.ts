/** Reduces Markdown to the words a reader sees, for snippets, previews and backlink context. Not a renderer. */
export function toPlainText(markdown: string): string {
  return markdown
    .replace(/```[^\n]*\n?/g, " ")
    .replace(/<[^>\n]+>/g, " ")
    .replace(/!\[([^\]\n]*)\]\([^)\n]*\)/g, "$1")
    .replace(/\[\[([^\]|\n]+)\|([^\]\n]+)\]\]/g, "$2")
    .replace(/\[\[([^\]\n]+)\]\]/g, "$1")
    .replace(/\[([^\]\n]*)\]\([^)\n]*\)/g, "$1")
    .replace(/\[([^\]\n]*)\]\[[^\]\n]*\]/g, "$1")
    .replace(/^[ \t]*(?:#{1,6}[ \t]+|>[ \t]?|[-*+][ \t]+\[[ xX]\][ \t]+|[-*+][ \t]+|\d+[.)][ \t]+)/gm, "")
    .replace(/^[ \t|:-]*-{3}[ \t|:-]*$/gm, " ")
    .replace(/[ \t]*\|[ \t]*/g, " ")
    .replace(/(\*\*|__|~~|[*`])/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
