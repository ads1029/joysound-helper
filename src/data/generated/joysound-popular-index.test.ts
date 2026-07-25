import { describe, expect, it } from "vitest";

import popularIndex from "./joysound-popular-index.json";

describe("joysound-popular-index", () => {
  it("完整记录 Sitemap 声明的热门候选页面", () => {
    expect(popularIndex.entries).toHaveLength(popularIndex.totalEntries);
    expect(popularIndex.entries).toHaveLength(2355);
  });

  it("每个候选链接唯一且包含更新时间", () => {
    const urls = popularIndex.entries.map((entry) => entry.url);

    expect(new Set(urls).size).toBe(urls.length);

    for (const entry of popularIndex.entries) {
      expect(entry.url).toMatch(
        /^https:\/\/www\.joysound\.com\/web\/search\/song\/\d+$/,
      );
      expect(entry.lastModified).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
});
