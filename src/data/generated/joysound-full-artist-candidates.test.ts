import { describe, expect, it } from "vitest";

import candidates from "./joysound-full-artist-candidates.json";

describe("joysound-full-artist-candidates", () => {
  it("以 95 位歌手的全部声明分页作为固定发现分母", () => {
    expect(candidates.summary).toMatchObject({
      targetedArtists: 95,
      unavailableSourcePages: 0,
      errorSourcePages: 0,
      inconsistentArtists: 0,
    });
    expect(
      candidates.summary.declaredSongEntries,
    ).toBeGreaterThanOrEqual(21193);
    expect(
      candidates.summary.plannedSourcePages,
    ).toBeGreaterThanOrEqual(1108);
    expect(
      candidates.summary.successfulSourcePages +
        candidates.summary.unavailableSourcePages +
        candidates.summary.errorSourcePages +
        candidates.summary.pendingSourcePages,
    ).toBe(candidates.summary.plannedSourcePages);
    expect(candidates.discoveryReady).toBe(
      candidates.summary.pendingSourcePages === 0 &&
        candidates.summary.errorSourcePages === 0 &&
        candidates.summary.inconsistentArtists === 0,
    );
  });

  it("候选链接唯一且生产收录状态与摘要一致", () => {
    const urls = candidates.entries.map((entry) => entry.url);
    const newEntries = candidates.entries.filter(
      (entry) => !entry.alreadyInProductionCatalog,
    );

    expect(new Set(urls).size).toBe(urls.length);
    expect(candidates.entries).toHaveLength(
      candidates.summary.uniqueSongPages,
    );
    expect(newEntries).toHaveLength(
      candidates.summary.newForProductionPages,
    );
    expect(
      candidates.entries.length - newEntries.length,
    ).toBe(candidates.summary.alreadyInProductionCatalogPages);

    for (const entry of candidates.entries) {
      expect(entry.url).toMatch(
        /^https:\/\/www\.joysound\.com\/web\/search\/song\/\d+$/,
      );
      expect(entry.sources.length).toBeGreaterThan(0);

      for (const source of entry.sources) {
        expect(source.page).toBeGreaterThanOrEqual(1);
        expect(source.rank).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it("逐歌手分页状态与候选数量可审计", () => {
    expect(candidates.artists).toHaveLength(95);

    for (const artist of candidates.artists) {
      expect(
        artist.successfulPages +
          artist.unavailablePages +
          artist.errorPages +
          artist.pendingPages,
      ).toBe(artist.plannedPages);
      expect(artist.candidateCount).toBeLessThanOrEqual(
        artist.declaredTotalCount,
      );
    }
  });
});
