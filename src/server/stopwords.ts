// Common English words that carry no topic. Dropped from AI retrieval queries and "related notes" term lists,
// where an OR search would otherwise rank notes by how often they say "what" or "the".
export const STOPWORDS = new Set(
  `a about above after again against all am an and any are as at be because been before being below between both but by can
  could did do does doing down during each few for from further had has have having he her here hers him his how i if in into
  is it its itself just me more most my no nor not now of off on once only or other our ours out over own same she should so
  some such than that the their theirs them then there these they this those through to too under until up very was we were
  what when where which while who whom why will with would you your yours tell show give list find explain describe summarize
  please`.split(/\s+/),
);

/** The words of a query worth searching for: lowercase, without stopwords or one-letter words. */
export function contentWords(text: string): string[] {
  return (text.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}_-]*/gu) ?? []).filter((w) => w.length > 1 && !STOPWORDS.has(w));
}
