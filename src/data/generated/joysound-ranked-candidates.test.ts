import { describe, expect, it } from "vitest";

import rankedCandidates from "./joysound-ranked-candidates.json";

describe("joysound-ranked-candidates", () => {
  it("完整记录榜单白名单入口和去重候选", () => {
    expect(rankedCandidates.summary).toMatchObject({
      requestedSourcePages: 151,
      successfulSourcePages: 151,
      unavailableSourcePages: 0,
      uniqueSongPages: 839,
      alreadyInPopularIndexPages: 7,
      newSongPages: 832,
      alreadyInProductionCatalogPages: 27,
      newForProductionPages: 812,
    });
    expect(rankedCandidates.entries).toHaveLength(839);
  });

  it("强制包含动漫与 Vocaloid 来源且不含重复歌曲页", () => {
    const urls = rankedCandidates.entries.map((entry) => entry.url);

    expect(new Set(urls).size).toBe(urls.length);
    expect(rankedCandidates.summary.sectionCounts.anime).toBe(204);
    expect(rankedCandidates.summary.sectionCounts.vocaloid).toBe(203);

    for (const entry of rankedCandidates.entries) {
      expect(entry.url).toMatch(
        /^https:\/\/www\.joysound\.com\/web\/search\/song\/\d+$/,
      );
      expect(entry.sources.length).toBeGreaterThan(0);
    }
  });
});
