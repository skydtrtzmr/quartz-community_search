import { describe, it, expect } from "vitest";
import {
  parseSearchQuery,
  matchYamlField,
  matchAllYamlQueries,
  extractRequiredTerms,
  matchesAllTerms,
  matchAllTags,
  type YamlQuery,
} from "../src/util/searchQuery";

describe("Search2 literal text and tag filtering", () => {
  it("rejects 26-27年 for 26年, but retains contiguous occurrences", () => {
    const terms = extractRequiredTerms("26年");
    expect(matchesAllTerms("SS20260007 | 26-27年第二次大修", terms)).toBe(false);
    expect(matchesAllTerms("SS20260005 | 26年第一次大修", terms)).toBe(true);
    expect(matchesAllTerms("SS20260003 | 2026年维保项目", terms)).toBe(true);
    expect(matchesAllTerms("26-27年第二次大修 正文提及2026年", terms)).toBe(true);
  });

  it("requires continuous Chinese phrases rather than scattered or reordered characters", () => {
    const terms = extractRequiredTerms("设备故障");
    expect(matchesAllTerms("设备正常，另有故障", terms)).toBe(false);
    expect(matchesAllTerms("故障设备", terms)).toBe(false);
    expect(matchesAllTerms("记录设备故障情况", terms)).toBe(true);
  });

  it("requires every space-separated term and ignores case", () => {
    const parsed = parseSearchQuery("@status:进行中 #项目 -废弃 SS2026   第一次大修");
    const terms = extractRequiredTerms(parsed.text);
    expect(terms).toEqual(["SS2026", "第一次大修"]);
    expect(matchesAllTerms("ss20260005 | 26年第一次大修", terms)).toBe(true);
    expect(matchesAllTerms("ss20260005 | 第二次大修", terms)).toBe(false);
    expect(matchesAllTerms("第一次大修 正文编号 ss20260005", terms)).toBe(true);
    expect(extractRequiredTerms(" \t\n")).toEqual([]);
  });

  it("treats punctuation literally rather than as a regular expression", () => {
    expect(matchesAllTerms("编号 A.01-02", ["a.01-02"])).toBe(true);
    expect(matchesAllTerms("编号 Ax01-02", ["a.01-02"])).toBe(false);
  });

  it("restores partial tag matching and requires all tag filters", () => {
    expect(matchAllTags(["项目负责人", "AI/设备"], ["负责人", "ai"])).toBe(true);
    expect(matchAllTags(["项目负责人"], ["负责人", "ai"])).toBe(false);
    expect(matchAllTags([], ["项目"])).toBe(false);
    expect(matchAllTags([], [])).toBe(true);
  });
});

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
