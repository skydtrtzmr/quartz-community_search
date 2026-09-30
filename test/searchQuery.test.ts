import { describe, it, expect } from "vitest";
import {
  parseSearchQuery,
  matchYamlField,
  matchAllYamlQueries,
  type YamlQuery,
} from "../src/util/searchQuery";

describe("parseSearchQuery", () => {
  it("parses plain text only", () => {
    expect(parseSearchQuery("机器学习 教程")).toEqual({
      yamlQueries: [],
      tags: [],
      text: "机器学习 教程",
      excludeYamlQueries: [],
      excludeTags: [],
      excludeTexts: [],
    });
  });

  it("parses tags with # prefix", () => {
    const parsed = parseSearchQuery("#AI #机器学习");
    expect(parsed.tags).toEqual(["AI", "机器学习"]);
    expect(parsed.text).toBe("");
  });

  it("parses @key:value into a key-value query", () => {
    const parsed = parseSearchQuery("@author:张三");
    expect(parsed.yamlQueries).toEqual([{ type: "key-value", key: "author", value: "张三" }]);
    expect(parsed.text).toBe("");
  });

  it("parses @key and @key: into key-only queries", () => {
    expect(parseSearchQuery("@author").yamlQueries).toEqual([{ type: "key-only", key: "author" }]);
    expect(parseSearchQuery("@author:").yamlQueries).toEqual([{ type: "key-only", key: "author" }]);
  });

  it("parses @:value into a value-only query", () => {
    expect(parseSearchQuery("@:草稿").yamlQueries).toEqual([{ type: "value-only", value: "草稿" }]);
  });

  it("parses -prefixed exclusions for text, tags and fields", () => {
    const parsed = parseSearchQuery("-#draft -@status:归档 -废弃 机器学习");
    expect(parsed.excludeTags).toEqual(["draft"]);
    expect(parsed.excludeYamlQueries).toEqual([
      { type: "key-value", key: "status", value: "归档" },
    ]);
    expect(parsed.excludeTexts).toEqual(["废弃"]);
    expect(parsed.text).toBe("机器学习");
  });

  it("splits a fully mixed query", () => {
    const parsed = parseSearchQuery("@author:张三 #AI -#draft -废弃 机器学习");
    expect(parsed.yamlQueries).toEqual([{ type: "key-value", key: "author", value: "张三" }]);
    expect(parsed.tags).toEqual(["AI"]);
    expect(parsed.text).toBe("机器学习");
    expect(parsed.excludeTags).toEqual(["draft"]);
    expect(parsed.excludeTexts).toEqual(["废弃"]);
    expect(parsed.excludeYamlQueries).toEqual([]);
  });

  it("returns empty buckets for a blank query", () => {
    expect(parseSearchQuery("   ")).toEqual({
      yamlQueries: [],
      tags: [],
      text: "",
      excludeYamlQueries: [],
      excludeTags: [],
      excludeTexts: [],
    });
  });
});

describe("matchYamlField", () => {
  const doc = {
    frontmatter: {
      title: "标题",
      tags: ["AI"],
      author: "张三",
      status: "归档",
      coauthors: ["李四", "王五"],
      empty: null,
    },
  };

  const keyOnly = (key: string): YamlQuery => ({ type: "key-only", key });
  const valueOnly = (value: string): YamlQuery => ({ type: "value-only", value });
  const keyValue = (key: string, value: string): YamlQuery => ({ type: "key-value", key, value });

  it("matches key-only by substring and case-insensitively", () => {
    expect(matchYamlField(doc, keyOnly("auth"))).toBe(true);
    expect(matchYamlField(doc, keyOnly("AUTHOR"))).toBe(true);
    expect(matchYamlField(doc, keyOnly("missing"))).toBe(false);
  });

  it("matches value-only across any field value", () => {
    expect(matchYamlField(doc, valueOnly("张三"))).toBe(true);
    expect(matchYamlField(doc, valueOnly("不存在"))).toBe(false);
  });

  it("matches key-value only when both key and value match", () => {
    expect(matchYamlField(doc, keyValue("author", "张三"))).toBe(true);
    expect(matchYamlField(doc, keyValue("author", "赵六"))).toBe(false);
    expect(matchYamlField(doc, keyValue("status", "归档"))).toBe(true);
  });

  it("fuzzy-matches keys, so a substring key hit can match another field", () => {
    // "author" is a substring of "coauthors", whose value contains 李四.
    expect(matchYamlField(doc, keyValue("author", "李四"))).toBe(true);
  });

  it("joins array values with spaces when matching", () => {
    expect(matchYamlField(doc, valueOnly("李四"))).toBe(true);
    expect(matchYamlField(doc, valueOnly("王五"))).toBe(true);
    expect(matchYamlField(doc, keyValue("coauthors", "李四 王五"))).toBe(true);
  });

  it("skips title and tags fields", () => {
    expect(matchYamlField(doc, keyOnly("title"))).toBe(false);
    expect(matchYamlField(doc, keyOnly("tags"))).toBe(false);
  });

  it("returns false when frontmatter is missing", () => {
    expect(matchYamlField({}, keyOnly("author"))).toBe(false);
  });

  it("ignores null field values", () => {
    expect(matchYamlField(doc, valueOnly("null"))).toBe(false);
  });
});

describe("matchAllYamlQueries", () => {
  const doc = { frontmatter: { author: "张三", status: "归档" } };

  it("requires every query to match (AND semantics)", () => {
    expect(
      matchAllYamlQueries(doc, [
        { type: "key-value", key: "author", value: "张三" },
        { type: "key-value", key: "status", value: "归档" },
      ]),
    ).toBe(true);
    expect(
      matchAllYamlQueries(doc, [
        { type: "key-value", key: "author", value: "张三" },
        { type: "key-value", key: "status", value: "草稿" },
      ]),
    ).toBe(false);
  });

  it("returns true for an empty query list", () => {
    expect(matchAllYamlQueries(doc, [])).toBe(true);
  });
});
