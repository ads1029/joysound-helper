import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import catalog from "./generated/joysound-production-catalog.json";
import { manualSongs } from "./manual-songs";
import { songs } from "./songs";

describe("songs", () => {
  it("收录通过晋级门禁的生产曲库", () => {
    const variantCount = songs.reduce(
      (count, song) => count + song.variants.length,
      0,
    );

    expect(catalog.productionReady).toBe(true);
    expect(catalog.summary.reviewedSamples).toBeGreaterThanOrEqual(20);
    expect(songs).toHaveLength(catalog.summary.songs);
    expect(variantCount).toBe(catalog.summary.variants);
  });

  it("生产曲库引用的审计、生成歌曲和复核报告均未发生变化", () => {
    const sources = [
      [catalog.source.catalogPath, catalog.source.catalogSha256],
      [
        catalog.source.generatedSongsPath,
        catalog.source.generatedSongsSha256,
      ],
      [catalog.source.reviewPath, catalog.source.reviewSha256],
    ];

    for (const [path, expectedSha256] of sources) {
      const content = readFileSync(resolve(path), "utf8");
      const actualSha256 = createHash("sha256")
        .update(content)
        .digest("hex");

      expect(actualSha256).toBe(expectedSha256);
    }
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
