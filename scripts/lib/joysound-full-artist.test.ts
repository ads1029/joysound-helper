import { describe, expect, it } from "vitest";

import {
  createCheckpointArtist,
  createFullArtistCandidateIndex,
  expectedArtistPageRange,
  extractFullArtistSeeds,
  resetCheckpointArtistTotalCount,
  summarizeCheckpointArtist,
  validateSuccessfulArtistPage,
  type FullArtistDiscoveryCheckpoint,
} from "./joysound-full-artist";

describe("joysound-full-artist", () => {
  it("只从未被排除的歌手首页建立完整分页计划", () => {
    const seeds = extractFullArtistSeeds({
      schemaVersion: 1,
      sources: [
        {
          id: "expanded-artist-10-page-1",
          url:
            "https://www.joysound.com/web/search/artist/10" +
            "?sort=popular&page=1",
          parser: "artist-catalog",
          status: "success",
          artistName: "测试歌手",
          totalCount: 41,
        },
        {
          id: "expanded-artist-10-page-2",
          url:
            "https://www.joysound.com/web/search/artist/10" +
            "?sort=popular&page=2",
          parser: "artist-catalog",
          status: "success",
          artistName: "测试歌手",
          totalCount: 41,
        },
        {
          id: "expanded-artist-20-page-1",
          url:
            "https://www.joysound.com/web/search/artist/20" +
            "?sort=popular&page=1",
          parser: "artist-catalog",
          status: "success",
          excludedByCategory: true,
          artistName: "排除歌手",
          totalCount: 80,
        },
      ],
    });

    expect(seeds).toEqual([
      {
        artistId: "10",
        artistName: "测试歌手",
        artistUrl:
          "https://www.joysound.com/web/search/artist/10",
        declaredTotalCount: 41,
        plannedPages: 3,
      },
    ]);
    expect(expectedArtistPageRange(seeds[0]!, 3)).toEqual({
      startIndex: 41,
      endIndex: 41,
      count: 1,
    });
  });

  it("拒绝把只保存十条的历史半页当成完整分页", () => {
    const seed = {
      artistId: "10",
      artistName: "测试歌手",
      artistUrl:
        "https://www.joysound.com/web/search/artist/10",
      declaredTotalCount: 41,
      plannedPages: 3,
    };

    expect(() =>
      validateSuccessfulArtistPage(seed, 2, {
        totalCount: 41,
        startIndex: 21,
        endIndex: 40,
        songUrls: Array.from(
          { length: 10 },
          (_, index) =>
            `https://www.joysound.com/web/search/song/${index + 21}`,
        ),
      }),
    ).toThrow("解析到 10 首，预期 20 首");
  });

  it("官方声明总数变化时重建该歌手的分页分母", () => {
    const artist = summarizeCheckpointArtist({
      ...createCheckpointArtist({
        artistId: "10",
        artistName: "测试歌手",
        artistUrl:
          "https://www.joysound.com/web/search/artist/10",
        declaredTotalCount: 39,
        plannedPages: 2,
      }),
      pages: {
        "1": {
          page: 1,
          url:
            "https://www.joysound.com/web/search/artist/10" +
            "?sort=popular&page=1",
          status: "success",
          fetchedAt: "2026-07-27T00:00:00.000Z",
          startIndex: 1,
          endIndex: 20,
          candidateUrls: Array.from(
            { length: 20 },
            (_, index) =>
              `https://www.joysound.com/web/search/song/${index + 1}`,
          ),
        },
      },
    });
    const reset = resetCheckpointArtistTotalCount(artist, 41);

    expect(reset).toMatchObject({
      declaredTotalCount: 41,
      plannedPages: 3,
      successfulPages: 0,
      pendingPages: 3,
      candidateUrls: [],
      pages: {},
    });
  });

  it("汇总分页状态并生成排除生产曲库后的唯一候选索引", () => {
    const seed = {
      artistId: "10",
      artistName: "测试歌手",
      artistUrl:
        "https://www.joysound.com/web/search/artist/10",
      declaredTotalCount: 2,
      plannedPages: 1,
    };
    const artist = summarizeCheckpointArtist({
      ...createCheckpointArtist(seed),
      pages: {
        "1": {
          page: 1,
          url:
            "https://www.joysound.com/web/search/artist/10" +
            "?sort=popular&page=1",
          status: "success",
          fetchedAt: "2026-07-27T00:00:00.000Z",
          startIndex: 1,
          endIndex: 2,
          candidateUrls: [
            "https://www.joysound.com/web/search/song/1",
            "https://www.joysound.com/web/search/song/2",
          ],
        },
      },
    });
    const checkpoint: FullArtistDiscoveryCheckpoint = {
      schemaVersion: 1,
      updatedAt: "2026-07-27T00:00:00.000Z",
      sourceIndexPath: "expanded.json",
      artists: { "10": artist },
    };
    const index = createFullArtistCandidateIndex(
      checkpoint,
      {
        songs: [
          {
            sourceUrl:
              "https://www.joysound.com/web/search/song/1",
          },
        ],
      },
      "2026-07-27T01:00:00.000Z",
    );

    expect(index.discoveryReady).toBe(true);
    expect(index.summary).toMatchObject({
      targetedArtists: 1,
      declaredSongEntries: 2,
      plannedSourcePages: 1,
      successfulSourcePages: 1,
      pendingSourcePages: 0,
      inconsistentArtists: 0,
      uniqueSongPages: 2,
      alreadyInProductionCatalogPages: 1,
      newForProductionPages: 1,
    });
    expect(index.entries[1]).toMatchObject({
      url: "https://www.joysound.com/web/search/song/2",
      alreadyInProductionCatalog: false,
    });
  });
});
