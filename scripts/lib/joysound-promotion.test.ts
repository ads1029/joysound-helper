import { describe, expect, it } from "vitest";

import type { Song } from "../../src/types";
import type { CatalogSnapshot } from "./joysound-catalog";
import {
  createProductionCatalog,
  type GeneratedSongSnapshot,
  type SourceReviewReport,
} from "./joysound-promotion";

const generatedSongs = Array.from(
  { length: 20 },
  (_, index) => createSong(index + 1),
);
const baseSong = createSong(999);
const generatedSourceUrls = generatedSongs.map((song) => song.sourceUrl);

describe("createProductionCatalog", () => {
  it("允许将干净且已复核的阶段性检查点晋级为精简生产曲库", () => {
    const productionCatalog = createProductionCatalog(
      createPromotionInput(),
    );

    expect(productionCatalog.productionReady).toBe(true);
    expect(productionCatalog.partialRelease).toBe(true);
    expect(productionCatalog.summary).toEqual({
      indexedCandidates: 21,
      processedCandidates: 20,
      pendingCandidates: 1,
      completionPercent: 95.24,
      baseSongs: 1,
      addedSongs: 20,
      songs: 21,
      variants: 21,
      reviewedSamples: 20,
    });
    expect(productionCatalog.songs).toHaveLength(21);
  });

  it("没有显式授权时拒绝发布未完成轮次", () => {
    expect(() =>
      createProductionCatalog({
        ...createPromotionInput(),
        allowPartial: false,
      }),
    ).toThrow("请显式使用 --allow-partial");
  });

  it("生成歌曲在复核后变化时拒绝晋级", () => {
    const input = createPromotionInput();

    input.review.inputSha256 = "过期指纹";

    expect(() => createProductionCatalog(input)).toThrow(
      "请重新复核",
    );
  });
});

function createPromotionInput() {
  const catalog: CatalogSnapshot = {
    schemaVersion: 1,
    generatedAt: "2026-07-29T00:00:00.000Z",
    sitemapUrl: "local-index:test#new-only",
    crawlReady: false,
    summary: {
      indexedCandidates: 21,
      processedCandidates: 20,
      pendingCandidates: 1,
      completionPercent: 95.24,
      successPages: 20,
      noX1Pages: 0,
      unavailablePages: 0,
      errorPages: 0,
      conflictCount: 0,
      productionSongs: 1,
      productionVariants: 1,
      generatedSongs: 20,
      generatedVariants: 20,
      newSongs: 20,
      overlappingSongs: 0,
      addedVariants: 20,
      mergedSongs: 21,
      mergedVariants: 21,
    },
    statusItems: {
      success: generatedSourceUrls,
      noX1: [],
      unavailable: [],
      error: [],
      pending: ["https://www.joysound.com/web/search/song/5000"],
      outsideIndex: [],
    },
    conflicts: [],
    songs: [baseSong, ...generatedSongs],
  };
  const generatedSnapshot: GeneratedSongSnapshot = {
    schemaVersion: 1,
    stats: {
      success: 20,
      "no-x1": 0,
      unavailable: 0,
      error: 0,
    },
    songs: generatedSongs,
  };
  const review: SourceReviewReport = {
    schemaVersion: 1,
    generatedAt: "2026-07-29T00:01:00.000Z",
    inputPath: "songs.json",
    inputSha256: "generated-hash",
    sampleSize: 20,
    passed: true,
    samples: generatedSongs.map((song) => ({
      sourceUrl: song.sourceUrl,
      matched: true,
      differences: [],
    })),
  };

  return {
    catalog,
    generatedSongs: generatedSnapshot,
    review,
    catalogPath: "catalog.json",
    catalogSha256: "catalog-hash",
    generatedSongsPath: "songs.json",
    generatedSongsSha256: "generated-hash",
    reviewPath: "review.json",
    reviewSha256: "review-hash",
    allowPartial: true,
    generatedAt: "2026-07-29T00:02:00.000Z",
  };
}

function createSong(index: number): Song {
  return {
    id: `song-${index}`,
    title: `歌曲 ${index}`,
    artist: `歌手 ${index}`,
    sourceUrl:
      `https://www.joysound.com/web/search/song/${1000 + index}`,
    variants: [
      {
        id: `variant-${index}`,
        songNumber: String(2000 + index),
        versionTitle: `歌曲 ${index}`,
        versionType: "standard",
        supportsX1: true,
      },
    ],
  };
}
