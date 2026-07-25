import { describe, expect, it } from "vitest";

import { songs } from "./songs";

describe("songs", () => {
  it("收录当前歌曲与 X1 版本基线", () => {
    const variantCount = songs.reduce(
      (count, song) => count + song.variants.length,
      0,
    );

    expect(songs).toHaveLength(20);
    expect(variantCount).toBe(60);
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

  it("每首前端歌曲都有可用于排序的罗马音", () => {
    for (const song of songs) {
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
