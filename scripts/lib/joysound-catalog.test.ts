import { describe, expect, it } from "vitest";

import type { Song } from "../../src/types";
import type { CrawlCheckpoint } from "./joysound-catalog";
import {
  createCatalogSnapshot,
  mergeSongCatalog,
} from "./joysound-catalog";

const sitemapUrl =
  "https://www.joysound.com/sitemap/contents/sitemap-songs-popular.xml";

const productionSong = createSong(
  "manual-1",
  "https://www.joysound.com/web/search/song/1",
  "既存曲",
  "既存歌手",
  "manual-variant-100",
  "100",
);

describe("mergeSongCatalog", () => {
  it("按来源链接合并已知歌曲，并追加新歌曲和新版本", () => {
    const overlappingSong: Song = {
      ...createSong(
        "joysound-1",
        productionSong.sourceUrl,
        productionSong.title,
        productionSong.artist,
        "joysound-1-100",
        "100",
      ),
      variants: [
        {
          ...productionSong.variants[0]!,
          id: "joysound-1-100",
        },
        {
          id: "joysound-1-101",
          songNumber: "101",
          versionTitle: "既存曲《本人映像》",
          versionType: "official-video",
          supportsX1: true,
        },
      ],
    };
    const newSong = createSong(
      "joysound-2",
      "https://www.joysound.com/web/search/song/2",
      "新曲",
      "新歌手",
      "joysound-2-200",
      "200",
    );
    const result = mergeSongCatalog(
      [productionSong],
      [overlappingSong, newSong],
    );

    expect(result.conflicts).toEqual([]);
    expect(result.stats).toMatchObject({
      newSongs: 1,
      overlappingSongs: 1,
      addedVariants: 2,
      mergedSongs: 2,
      mergedVariants: 3,
    });
    expect(
      result.songs
        .flatMap((song) => song.variants)
        .map((variant) => variant.songNumber),
    ).toEqual(["100", "101", "200"]);
  });

  it("报告同一来源元数据变化和跨歌曲曲号冲突", () => {
    const changedMetadata = createSong(
      "joysound-1",
      productionSong.sourceUrl,
      "错误歌名",
      productionSong.artist,
      "joysound-1-101",
      "101",
    );
    const duplicateNumber = createSong(
      "joysound-2",
      "https://www.joysound.com/web/search/song/2",
      "另一首歌",
      "另一歌手",
      "joysound-2-100",
      "100",
    );
    const result = mergeSongCatalog(
      [productionSong],
      [changedMetadata, duplicateNumber],
    );

    expect(result.conflicts.map((conflict) => conflict.kind)).toEqual([
      "song-metadata",
      "song-number",
    ]);
    expect(result.stats.newSongs).toBe(0);
    expect(result.songs).toHaveLength(1);
  });
});

describe("createCatalogSnapshot", () => {
  it("以完整候选索引为分母统计覆盖率和采集状态", () => {
    const generatedOverlap = createSong(
      "joysound-1",
      productionSong.sourceUrl,
      productionSong.title,
      productionSong.artist,
      "joysound-1-100",
      "100",
    );
    const generatedNew = createSong(
      "joysound-2",
      "https://www.joysound.com/web/search/song/2",
      "新曲",
      "新歌手",
      "joysound-2-200",
      "200",
    );
    const checkpoint: CrawlCheckpoint = {
      schemaVersion: 1,
      sitemapUrl,
      updatedAt: "2026-07-25T00:00:00.000Z",
      items: {
        [generatedOverlap.sourceUrl]: createSuccessItem(generatedOverlap),
        [generatedNew.sourceUrl]: createSuccessItem(generatedNew),
        "https://www.joysound.com/web/search/song/3": {
          status: "error",
          attemptedAt: "2026-07-25T00:00:00.000Z",
          error: "测试错误",
        },
      },
    };
    const snapshot = createCatalogSnapshot(
      {
        sitemapUrl,
        entries: [
          { url: generatedOverlap.sourceUrl },
          { url: generatedNew.sourceUrl },
          { url: "https://www.joysound.com/web/search/song/3" },
          { url: "https://www.joysound.com/web/search/song/4" },
        ],
      },
      checkpoint,
      [productionSong],
      "2026-07-25T01:00:00.000Z",
    );

    expect(snapshot.summary).toMatchObject({
      indexedCandidates: 4,
      processedCandidates: 3,
      pendingCandidates: 1,
      completionPercent: 75,
      successPages: 2,
      errorPages: 1,
      generatedSongs: 2,
      mergedSongs: 2,
      conflictCount: 0,
    });
    expect(snapshot.statusItems.pending).toEqual([
      "https://www.joysound.com/web/search/song/4",
    ]);
    expect(snapshot.crawlReady).toBe(false);
  });

  it("把检查点缺失歌曲和索引外页面计入冲突", () => {
    const indexedUrl = "https://www.joysound.com/web/search/song/2";
    const outsideUrl = "https://www.joysound.com/web/search/song/9";
    const checkpoint: CrawlCheckpoint = {
      schemaVersion: 1,
      sitemapUrl,
      updatedAt: "2026-07-25T00:00:00.000Z",
      items: {
        [indexedUrl]: {
          status: "success",
          attemptedAt: "2026-07-25T00:00:00.000Z",
        },
        [outsideUrl]: {
          status: "no-x1",
          attemptedAt: "2026-07-25T00:00:00.000Z",
        },
      },
    };
    const snapshot = createCatalogSnapshot(
      {
        sitemapUrl,
        entries: [{ url: indexedUrl }],
      },
      checkpoint,
      [],
    );

    expect(snapshot.statusItems.outsideIndex).toEqual([outsideUrl]);
    expect(snapshot.conflicts).toHaveLength(2);
    expect(snapshot.summary.conflictCount).toBe(2);
    expect(snapshot.crawlReady).toBe(false);
  });
});

function createSong(
  id: string,
  sourceUrl: string,
  title: string,
  artist: string,
  variantId: string,
  songNumber: string,
): Song {
  return {
    id,
    sourceUrl,
    title,
    artist,
    variants: [
      {
        id: variantId,
        songNumber,
        versionTitle: title,
        versionType: "standard",
        supportsX1: true,
      },
    ],
  };
}

function createSuccessItem(song: Song) {
  return {
    status: "success" as const,
    attemptedAt: "2026-07-25T00:00:00.000Z",
    song,
  };
}
