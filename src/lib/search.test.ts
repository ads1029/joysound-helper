import { describe, expect, it } from "vitest";

import { manualSongs } from "../data/manual-songs";
import { songs } from "../data/songs";
import type { Song } from "../types";
import {
  CATALOG_PAGE_SIZE,
  listSongsByRomaji,
  searchSongs,
  searchSongsByArtist,
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

  it("matches a title without requiring its punctuation or symbols", () => {
    const fixture: Song[] = [
      {
        id: "punctuated-title",
        title: "大丈夫！？★ Song 2026",
        artist: "テスト",
        sourceUrl: "https://example.com",
        variants: [
          {
            id: "punctuated-title-x1",
            songNumber: "123456",
            versionTitle: "大丈夫！？★ Song 2026",
            versionType: "standard",
            supportsX1: true,
          },
        ],
      },
    ];

    expect(searchSongs(fixture, "大丈夫Song")).toHaveLength(1);
  });

  it("matches kana and Latin fragments with at least two characters", () => {
    expect(searchSongs(songs, "ふぁむ").map((song) => song.title)).toContain(
      "・ふぁむ・ふぁた～る・",
    );
    expect(searchSongs(songs, "knows").map((song) => song.title)).toContain(
      "God knows...",
    );
    expect(
      searchSongs(songs, "残酷な天使").map((song) => song.title),
    ).toContain("残酷な天使のテーゼ");
  });

  it("matches hiragana and katakana queries in both directions", () => {
    expect(searchSongs(songs, "あいどる").map((song) => song.title)).toContain(
      "アイドル",
    );
    expect(searchSongs(songs, "ファム").map((song) => song.title)).toContain(
      "・ふぁむ・ふぁた～る・",
    );
    expect(searchSongs(songs, "ｱｲﾄﾞﾙ").map((song) => song.title)).toContain(
      "アイドル",
    );
  });

  it("treats wave dashes and kana long vowels as equivalent", () => {
    expect(
      searchSongs(songs, "ふぁむふぁたーる").map((song) => song.title),
    ).toContain("・ふぁむ・ふぁた～る・");
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

  it("allows a cross-kana exact title without fuzzy-matching one character", () => {
    expect(searchSongs(songs, "ふ").map((song) => song.title)).toContain("フ");
    expect(searchSongs(songs, "千")).toEqual([]);
    expect(searchSongs(songs, "g")).toEqual([]);
    expect(searchSongs(songs, "一千棵樱花树")).toEqual([]);
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

describe("searchSongsByArtist", () => {
  it("places exact artist matches before collaborations", () => {
    const results = searchSongsByArtist(songs, "米津玄師");
    const firstCollaborationIndex = results.findIndex(
      (song) => song.artist !== "米津玄師",
    );

    expect(results.length).toBeGreaterThan(1);
    expect(firstCollaborationIndex).toBeGreaterThan(0);
    expect(
      results
        .slice(0, firstCollaborationIndex)
        .every((song) => song.artist === "米津玄師"),
    ).toBe(true);
    expect(
      results
        .slice(firstCollaborationIndex)
        .every((song) => song.artist.includes("米津玄師")),
    ).toBe(true);
  });

  it("normalizes spaces, punctuation, case, and kanji variants", () => {
    expect(
      searchSongsByArtist(songs, "mrs green apple").some(
        (song) => song.artist === "Mrs. GREEN APPLE",
      ),
    ).toBe(true);
    expect(
      searchSongsByArtist(songs, "藤井风").some(
        (song) => song.artist === "藤井 風",
      ),
    ).toBe(true);
  });

  it("matches hiragana and katakana artist names in both directions", () => {
    const hiraganaResults = searchSongsByArtist(songs, "よるしか");
    const katakanaResults = searchSongsByArtist(songs, "ヨルシカ");

    expect(hiraganaResults.length).toBeGreaterThan(0);
    expect(hiraganaResults.map((song) => song.id)).toEqual(
      katakanaResults.map((song) => song.id),
    );
  });

  it("includes collaborations containing the artist query", () => {
    const fixture: Song[] = [
      {
        id: "solo",
        title: "独唱",
        artist: "Ado",
        sourceUrl: "https://example.com/solo",
        variants: [
          {
            id: "solo-x1",
            songNumber: "123456",
            versionTitle: "独唱",
            versionType: "standard",
            supportsX1: true,
          },
        ],
      },
      {
        id: "collaboration",
        title: "合唱",
        artist: "Ado feat. テスト",
        sourceUrl: "https://example.com/collaboration",
        variants: [
          {
            id: "collaboration-x1",
            songNumber: "234567",
            versionTitle: "合唱",
            versionType: "standard",
            supportsX1: true,
          },
        ],
      },
    ];

    expect(
      searchSongsByArtist(fixture, "Ado").map((song) => song.id),
    ).toEqual(["solo", "collaboration"]);
  });

  it("allows a one-character exact artist but rejects broad fragments", () => {
    expect(searchSongsByArtist(songs, "嵐").length).toBeGreaterThan(1);
    expect(searchSongsByArtist(songs, "米")).toEqual([]);
  });
});
