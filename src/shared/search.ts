import type { Options } from "minisearch";

export interface SearchDocument {
  id: string;
  title: string;
  path: string;
  headings: string;
  meta: string;
  body: string;
}

/** One set of index options for the server and an exported site's in-browser search, which loads the server's index. */
export const SEARCH_OPTIONS: Options<SearchDocument> = {
  fields: ["title", "path", "headings", "meta", "body"],
  storeFields: ["title"],
  searchOptions: { boost: { title: 4, path: 2, headings: 2, meta: 1.5 }, prefix: true, fuzzy: 0.15 },
};
