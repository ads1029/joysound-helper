import { describe, expect, it } from "vitest";

import candidates from "./joysound-expanded-candidates.json";

describe("joysound-expanded-candidates", () => {
  it("达到热门歌手与近三十年榜单扩展目标", () => {
    expect(candidates.summary).toMatchObject({
      rankedArtistCount: 102,
      excludedRankedArtistCount: 7,
      selectedArtistCount: 95,
      requestedSourcePages: 203,
      successfulSourcePages: 203,
      unavailableSourcePages: 0,
      uniqueSongPages: 2889,
      alreadyInProductionCatalogPages: 454,
      newForProductionPages: 2435,
      artistExpandedPages: 2820,
      heiseiPages: 122,
    });
    expect(
      candidates.summary.newForProductionPages,
    ).toBeGreaterThanOrEqual(2000);
  });

  it("候选唯一、歌手排名有效并记录排除规则", () => {
    const urls = candidates.entries.map((entry) => entry.url);
    const excludedArtists = candidates.sources
      .filter((source) => source.excludedByCategory)
      .map((source) => source.artistName);

    expect(new Set(urls).size).toBe(urls.length);
    expect(excludedArtists).toEqual([
      "テレサ・テン",
      "吉幾三",
      "五木ひろし",
      "石原裕次郎",
      "石川さゆり",
      "美空ひばり",
      "北島三郎",
    ]);
    expect(candidates.policy.artistLimit).toBe(30);
    expect(candidates.policy.historicalYears).toBe("1996-2011");

    for (const entry of candidates.entries) {
      expect(entry.url).toMatch(
        /^https:\/\/www\.joysound\.com\/web\/search\/song\/\d+$/,
      );

      for (const source of entry.sources) {
        if (source.rank !== undefined) {
          expect(source.rank).toBeGreaterThanOrEqual(1);
          expect(source.rank).toBeLessThanOrEqual(30);
        }
      }
    }
  });
});
