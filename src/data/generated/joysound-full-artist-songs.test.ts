import { describe, expect, it } from "vitest";

import songs from "./joysound-full-artist-songs.json";

describe("joysound-full-artist-songs", () => {
  it("详情采集状态与生成歌曲数量一致", () => {
    expect(songs.stats.error).toBe(0);
    expect(songs.stats.success).toBeGreaterThanOrEqual(20);
    expect(songs.songs).toHaveLength(songs.stats.success);
    expect(
      songs.stats.success +
        songs.stats["no-x1"] +
        songs.stats.unavailable +
        songs.stats.error,
    ).toBeGreaterThanOrEqual(20);
  });

  it("歌曲、来源和 X1 版本保持唯一且格式有效", () => {
    const songIds = songs.songs.map((song) => song.id);
    const sourceUrls = songs.songs.map(
      (song) => song.sourceUrl,
    );
    const variantIds = songs.songs.flatMap((song) =>
      song.variants.map((variant) => variant.id),
    );
    const songNumbers = songs.songs.flatMap((song) =>
      song.variants.map((variant) => variant.songNumber),
    );

    expect(new Set(songIds).size).toBe(songIds.length);
    expect(new Set(sourceUrls).size).toBe(sourceUrls.length);
    expect(new Set(variantIds).size).toBe(variantIds.length);
    expect(new Set(songNumbers).size).toBe(songNumbers.length);

    for (const song of songs.songs) {
      expect(song.id).toMatch(/^joysound-\d+$/);
      expect(song.title.length).toBeGreaterThan(0);
      expect(song.artist.length).toBeGreaterThan(0);
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
