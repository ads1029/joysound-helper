import { describe, expect, it } from "vitest";

import {
  parseJoysoundSongPage,
  parseSitemapXml,
  validateCrawlSongs,
} from "./joysound-parser";

const sitemapFixture = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://www.joysound.com/web/search/song/123456</loc>
    <lastmod>2026-07-25</lastmod>
  </url>
  <url>
    <loc>https://example.com/not-allowed</loc>
  </url>
</urlset>`;

const songPageFixture = `<!doctype html>
<html lang="ja">
  <head>
    <script type="application/ld+json">
      {
        "@context": "https://schema.org",
        "@graph": [
          {
            "@type": "MusicRecording",
            "name": "試験曲",
            "byArtist": { "@type": "MusicGroup", "name": "試験歌手" }
          }
        ]
      }
    </script>
  </head>
  <body>
    <div data-testid="card-information">
      <p>試験曲</p>
      <div><span>曲番号:</span>123456</div>
      <span>JOYSOUND X1</span>
    </div>
    <div data-testid="card-information">
      <p>試験曲《本人映像》</p>
      <div><span>曲番号:</span>718000</div>
      <span>JOYSOUND X1</span>
    </div>
    <div data-testid="card-information">
      <p>試験曲《旧機種版》</p>
      <div><span>曲番号:</span>999999</div>
      <span>JOYSOUND f1</span>
    </div>
  </body>
</html>`;

const musicVideoPageFixture = `<!doctype html>
<html lang="ja">
  <head>
    <title>[ミュージックビデオ観放題]黒毛和牛上塩タン焼680円／大塚 愛-楽曲検索 | JOYSOUND.com</title>
  </head>
  <body>
    <h1>この曲を楽しむ</h1>
  </body>
</html>`;

describe("parseSitemapXml", () => {
  it("只读取官方歌曲链接与更新时间", () => {
    expect(parseSitemapXml(sitemapFixture)).toEqual([
      {
        url: "https://www.joysound.com/web/search/song/123456",
        lastModified: "2026-07-25",
      },
    ]);
  });
});

describe("parseJoysoundSongPage", () => {
  it("提取歌曲信息并过滤非 X1 版本", () => {
    const song = parseJoysoundSongPage(
      songPageFixture,
      "https://www.joysound.com/web/search/song/123456",
    );

    expect(song).toMatchObject({
      id: "joysound-123456",
      title: "試験曲",
      artist: "試験歌手",
    });
    expect(song.variants).toEqual([
      {
        id: "joysound-123456-123456",
        songNumber: "123456",
        versionTitle: "試験曲",
        versionType: "standard",
        supportsX1: true,
      },
      {
        id: "joysound-123456-718000",
        songNumber: "718000",
        versionTitle: "試験曲《本人映像》",
        versionType: "official-video",
        supportsX1: true,
      },
    ]);
    expect(validateCrawlSongs([song])).toEqual([]);
  });

  it("从ミュージックビデオ観放題页面标题提取歌曲信息", () => {
    const song = parseJoysoundSongPage(
      musicVideoPageFixture,
      "https://www.joysound.com/web/search/song/5850298",
    );

    expect(song).toMatchObject({
      id: "joysound-5850298",
      title: "黒毛和牛上塩タン焼680円",
      artist: "大塚 愛",
      variants: [],
    });
  });

  it("校验重复来源页面", () => {
    const song = parseJoysoundSongPage(
      songPageFixture,
      "https://www.joysound.com/web/search/song/123456",
    );

    expect(validateCrawlSongs([song, { ...song, id: "duplicate-song" }])).toContain(
      "歌曲来源重复：https://www.joysound.com/web/search/song/123456",
    );
  });
});
