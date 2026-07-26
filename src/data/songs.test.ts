import { describe, expect, it } from "vitest";

import catalog from "./generated/joysound-expanded-catalog.json";
import { manualSongs } from "./manual-songs";
import { songs } from "./songs";

describe("songs", () => {
  it("收录审计通过的完整生产曲库", () => {
    const variantCount = songs.reduce(
      (count, song) => count + song.variants.length,
      0,
    );

    expect(catalog.crawlReady).toBe(true);
    expect(songs).toHaveLength(5620);
    expect(songs).toHaveLength(catalog.summary.mergedSongs);
    expect(variantCount).toBe(10761);
    expect(variantCount).toBe(catalog.summary.mergedVariants);
  });

  it("歌曲和版本标识保持唯一", () => {
    const songIds = songs.map((song) => song.id);
    const variants = songs.flatMap((song) => song.variants);
    const variantIds = variants.map((variant) => variant.id);
    const songNumbers = variants.map((variant) => variant.songNumber);

    expect(new Set(songIds).size).toBe(songIds.length);
    expect(new Set(variantIds).size).toBe(variantIds.length);
    expect(new Set(songNumbers).size).toBe(songNumbers.length);
  });

  it("手工维护的核心歌曲保留罗马音排序信息", () => {
    for (const song of manualSongs) {
      expect(song.romaji).toMatch(/[a-z]/i);
    }
  });

  it("只包含可追溯的 JOYSOUND X1 数字曲号", () => {
    for (const song of songs) {
      expect(song.sourceUrl).toMatch(
        /^https:\/\/www\.joysound\.com\/web\/search\/song\/\d+$/,
      );
      expect(song.variants.length).toBeGreaterThan(0);

      for (const variant of song.variants) {
        expect(variant.songNumber).toMatch(/^\d+$/);
        expect(variant.supportsX1).toBe(true);
      }
    }
  });
});
