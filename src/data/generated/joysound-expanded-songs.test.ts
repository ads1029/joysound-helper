import { describe, expect, it } from "vitest";

import expandedSongs from "./joysound-expanded-songs.json";

describe("joysound-expanded-songs", () => {
  it("完整记录热门歌手与平成榜扩展详情", () => {
    const processedPages = Object.values(expandedSongs.stats).reduce(
      (count, value) => count + value,
      0,
    );
    const variantCount = expandedSongs.songs.reduce(
      (count, song) => count + song.variants.length,
      0,
    );

    expect(expandedSongs.stats).toEqual({
      success: 2435,
      "no-x1": 0,
      unavailable: 0,
      error: 0,
    });
    expect(processedPages).toBe(2435);
    expect(expandedSongs.songs).toHaveLength(2435);
    expect(variantCount).toBe(5607);
  });

  it("歌曲、来源和 X1 曲号保持唯一且格式有效", () => {
    const songIds = new Set<string>();
    const sourceUrls = new Set<string>();
    const variantIds = new Set<string>();
    const songNumbers = new Set<string>();

    for (const song of expandedSongs.songs) {
      expect(songIds.has(song.id)).toBe(false);
      expect(sourceUrls.has(song.sourceUrl)).toBe(false);
      expect(song.sourceUrl).toMatch(
        /^https:\/\/www\.joysound\.com\/web\/search\/song\/\d+$/,
      );
      expect(song.variants.length).toBeGreaterThan(0);
      songIds.add(song.id);
      sourceUrls.add(song.sourceUrl);

      for (const variant of song.variants) {
        expect(variantIds.has(variant.id)).toBe(false);
        expect(songNumbers.has(variant.songNumber)).toBe(false);
        expect(variant.songNumber).toMatch(/^\d+$/);
        expect(variant.supportsX1).toBe(true);
        variantIds.add(variant.id);
        songNumbers.add(variant.songNumber);
      }
    }
  });
});
