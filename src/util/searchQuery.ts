/**
 * Pure query-parsing helpers for the mixed search syntax.
 *
 * Supports, in a single whitespace-separated query:
 * - free text (matched against title/content via FlexSearch)
 * - `#tag` tag filters
 * - `@key:value` / `@key` / `@:value` frontmatter (field) filters
 * - `-` prefixed exclusions for any of the above (`-#tag`, `-@key:value`, `-text`)
 *
 * Migrated from the Quartz v4 client search (`search2.inline.ts`) so both sites
 * share an identical query grammar.
 */

export type YamlQuery = {
  type: "key-value" | "value-only" | "key-only";
  key?: string;
  value?: string;
};

export interface ParsedSearchQuery {
  yamlQueries: YamlQuery[];
  tags: string[];
  text: string;
  excludeYamlQueries: YamlQuery[];
  excludeTags: string[];
  excludeTexts: string[];
}

/**
 * Split a raw search string into field queries, tags, free text and the
 * corresponding exclusion lists.
 *
 * Example: `"@author:张三 #AI -#draft -废弃 机器学习"` →
 * `{ yamlQueries: [{key:'author',value:'张三'}], tags: ['AI'], text: '机器学习', ... }`
 */
export function parseSearchQuery(searchTerm: string): ParsedSearchQuery {
  const yamlQueries: YamlQuery[] = [];
  const tags: string[] = [];
  const textParts: string[] = [];
  const excludeYamlQueries: YamlQuery[] = [];
  const excludeTags: string[] = [];
  const excludeTexts: string[] = [];

  const tokens = searchTerm.trim().split(/\s+/);

  for (const token of tokens) {
    const isExclude = token.startsWith("-") && token.length > 1;
    const actualToken = isExclude ? token.substring(1) : token;

    if (actualToken.startsWith("@")) {
      // Field (frontmatter) search
      const yamlTerm = actualToken.substring(1);
      const colonIndex = yamlTerm.indexOf(":");
      const targetList = isExclude ? excludeYamlQueries : yamlQueries;

      if (colonIndex === -1) {
        // @key - match documents that contain this key
        const key = yamlTerm.trim();
        if (key) targetList.push({ type: "key-only", key });
      } else {
        const key = yamlTerm.substring(0, colonIndex).trim();
        const value = yamlTerm.substring(colonIndex + 1).trim();

        if (!key && value) {
          // @:value - match this value in any field
          targetList.push({ type: "value-only", value });
        } else if (key && !value) {
          // @key: - match documents that contain this key
          targetList.push({ type: "key-only", key });
        } else if (key && value) {
          // @key:value - match this key/value pair
          targetList.push({ type: "key-value", key, value });
        }
      }
    } else if (actualToken.startsWith("#")) {
      // Tag search
      const tag = actualToken.substring(1).trim();
      if (tag) {
        if (isExclude) {
          excludeTags.push(tag);
        } else {
          tags.push(tag);
        }
      }
    } else {
      // Free text
      if (isExclude) {
        excludeTexts.push(actualToken);
      } else {
        textParts.push(token);
      }
    }
  }

  return {
    yamlQueries,
    tags,
    text: textParts.join(" "),
    excludeYamlQueries,
    excludeTags,
    excludeTexts,
  };
}

type YamlDoc = { frontmatter?: Record<string, unknown> };

/**
 * Fuzzy-match a single field query against a document's frontmatter.
 *
 * - `key-only`: document contains a key containing the query key.
 * - `value-only`: some field value contains the query value.
 * - `key-value`: both key and value match.
 *
 * Matching is case-insensitive and substring-based. `title` / `tags` are skipped
 * because they have dedicated search fields. Array values are joined with spaces.
 */
export function matchYamlField(doc: YamlDoc, yamlSearch: YamlQuery): boolean {
  if (!doc.frontmatter) return false;

  for (const [key, value] of Object.entries(doc.frontmatter)) {
    if (key === "title" || key === "tags") continue;

    const lowerKey = key.toLowerCase();

    if (yamlSearch.type === "key-only") {
      const lowerSearchKey = (yamlSearch.key ?? "").toLowerCase();
      if (lowerKey.includes(lowerSearchKey)) {
        return true;
      }
    } else if (yamlSearch.type === "value-only") {
      if (value === null || value === undefined) continue;
      const valueStr = Array.isArray(value) ? value.join(" ") : String(value);
      const lowerSearchValue = (yamlSearch.value ?? "").toLowerCase();
      if (valueStr.toLowerCase().includes(lowerSearchValue)) {
        return true;
      }
    } else if (yamlSearch.type === "key-value") {
      const lowerSearchKey = (yamlSearch.key ?? "").toLowerCase();
      const lowerSearchValue = (yamlSearch.value ?? "").toLowerCase();

      if (!lowerKey.includes(lowerSearchKey)) continue;
      if (value === null || value === undefined) continue;

      const valueStr = Array.isArray(value) ? value.join(" ") : String(value);
      if (valueStr.toLowerCase().includes(lowerSearchValue)) {
        return true;
      }
    }
  }

  return false;
}

/** Document matches only when every field query matches (AND semantics). */
export function matchAllYamlQueries(doc: YamlDoc, queries: YamlQuery[]): boolean {
  return queries.every((query) => matchYamlField(doc, query));
}
