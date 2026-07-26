import { describe, expect, it } from "vitest";

import { manualSongs } from "../data/manual-songs";
import { songs } from "../data/songs";
import type { Song } from "../types";
import {
  CATALOG_PAGE_SIZE,
  listSongsByRomaji,
  searchSongs,
} from "./search";

describe("searchSongs", () => {
  it("finds a song by its exact Japanese title", () => {
    const results = searchSongs(songs, "千本桜");

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      title: "千本桜",
      artist: "WhiteFlame feat.初音ミク",
    });
  });

  it("matches equivalent simplified and traditional Chinese characters", () => {
    expect(searchSongs(songs, "千本樱")[0]?.title).toBe("千本桜");
    expect(searchSongs(songs, "千本櫻")[0]?.title).toBe("千本桜");
    expect(searchSongs(songs, "夜に驱ける")[0]?.title).toBe("夜に駆ける");
    expect(searchSongs(songs, "夜に驅ける")[0]?.title).toBe("夜に駆ける");
  });

  it("matches a kanji-only query after removing kana from the title", () => {
    expect(searchSongs(songs, "残酷天使").map((song) => song.title)).toContain(
      "残酷な天使のテーゼ",
    );
    expect(searchSongs(songs, "夜驱").map((song) => song.title)).toContain(
      "夜に駆ける",
    );
    expect(searchSongs(songs, "青夏").map((song) => song.title)).toContain(
      "青と夏",
    );
  });

  it("fuzzy-matches a title from a kanji-only fragment", () => {
    expect(searchSongs(songs, "千本").map((song) => song.title)).toContain(
      "千本桜",
    );
    expect(searchSongs(songs, "本樱").map((song) => song.title)).toContain(
      "千本桜",
    );
  });

  it("does not fuzzy-match one kanji, kana, or a translated title", () => {
    expect(searchSongs(songs, "千")).toEqual([]);
    expect(searchSongs(songs, "一千棵樱花树")).toEqual([]);
    expect(searchSongs(songs, "残酷な天使")).toEqual([]);
  });

  it("lists the catalog in romaji order with ten songs per page", () => {
    const catalog = listSongsByRomaji(manualSongs);

    expect(catalog.slice(0, CATALOG_PAGE_SIZE)).toHaveLength(10);
    expect(catalog.slice(CATALOG_PAGE_SIZE)).toHaveLength(10);
    expect(catalog.map((song) => song.romaji)).toEqual([
      "aidoru",
      "ao no sumika",
      "ao to natsu",
      "bansanka",
      "bling-bang-bang-born",
      "butter-fly",
      "daarin",
      "god knows",
      "iris out",
      "kaibutsu",
      "kaijuu no hanauta",
      "lemon",
      "mariigoorudo",
      "only my railgun",
      "rairakku",
      "saudaaji",
      "senbonzakura",
      "suiheisen",
      "yoru ni kakeru",
      "zankoku na tenshi no teeze",
    ]);
  });

  it("only returns X1 variants", () => {
    const fixture: Song[] = [
      {
        id: "fixture",
        title: "試験曲",
        romaji: "shikenkyoku",
        artist: "テスト",
        sourceUrl: "https://example.com",
        variants: [
          {
            id: "x1",
            songNumber: "123456",
            versionTitle: "試験曲",
            versionType: "standard",
            supportsX1: true,
          },
          {
            id: "legacy",
            songNumber: "000001",
            versionTitle: "試験曲《旧機種版》",
            versionType: "other",
            supportsX1: false,
          },
        ],
      },
    ];

    const results = searchSongs(fixture, "試験曲");

    expect(results[0]?.variants.map((variant) => variant.songNumber)).toEqual([
      "123456",
    ]);
  });
});
