import { describe, expect, it } from "vitest";

import {
  extractAge10To40SongUrls,
  extractAllSongUrls,
  extractAnnualSongUrls,
  extractArtistCatalogPage,
  extractArtistPopularSongUrls,
  extractArtistUrls,
  extractCategoryRankingArtistUrls,
  extractHeiseiYearSongUrls,
  extractRankingArtistNames,
} from "./joysound-ranking";

describe("joysound-ranking", () => {
  it("从服务端 HTML 和 Next 数据中提取唯一歌曲及歌手链接", () => {
    const html = `
      <a href="/web/search/song/100">歌曲</a>
      \\"href\\":\\"/web/search/song/101\\"
      \\"href\\":\\"/web/search/song/100\\"
      <a href="/web/search/artist/20">歌手</a>
    `;

    expect(extractAllSongUrls(html)).toEqual([
      "https://www.joysound.com/web/search/song/100",
      "https://www.joysound.com/web/search/song/101",
    ]);
    expect(extractArtistUrls(html)).toEqual([
      "https://www.joysound.com/web/search/artist/20",
    ]);
  });

  it("从歌手曲目分页读取数量范围和唯一歌曲链接", () => {
    const html = `
      <section>
        <h2>"测试歌手"の曲一覧</h2>
        <h2>41件(21-40件目表示)</h2>
        <a href="/web/search/song/21">歌曲 21</a>
        <a href="/web/search/song/21#lyrics">歌词</a>
        <a href="/web/search/song/22">歌曲 22</a>
      </section>
      <section>
        <a href="/web/search/song/999">其他区域</a>
      </section>
    `;

    expect(extractArtistCatalogPage(html)).toEqual({
      totalCount: 41,
      startIndex: 21,
      endIndex: 40,
      songUrls: [
        "https://www.joysound.com/web/search/song/21",
        "https://www.joysound.com/web/search/song/22",
      ],
    });
  });

  it("按年份读取平成榜，并从指定分类段落提取排除歌手", () => {
    const html = `
      <div id="ranking-1995">
        <a href="/web/search/song/95">1995</a>
      </div>
      <div id="ranking-1996">
        <a href="/web/search/song/96">1996</a>
      </div>
      <div id="ranking-1997">
        <a href="/web/search/song/97">1997</a>
      </div>
      <h2>洋楽</h2>
      <div>
        <a href="/web/search/artist/1">外国歌手</a>
      </div>
      <h2>アニメ</h2>
      <div>
        <a href="/web/search/artist/2">动漫歌手</a>
      </div>
    `;

    expect(extractHeiseiYearSongUrls(html, [1996, 1997])).toEqual({
      "1996": ["https://www.joysound.com/web/search/song/96"],
      "1997": ["https://www.joysound.com/web/search/song/97"],
    });
    expect(
      extractCategoryRankingArtistUrls(html, /^洋楽$/),
    ).toEqual([
      "https://www.joysound.com/web/search/artist/1",
    ]);
  });

  it("从榜单的 Next 数据中提取唯一歌手名", () => {
    const html = String.raw`
      \"artistName\":\"石川さゆり\"
      \"artistName\":\"テレサ・テン\"
      \"artistName\":\"石川さゆり\"
      {"artistName":"Ed Sheeran"}
    `;

    expect(extractRankingArtistNames(html)).toEqual([
      "Ed Sheeran",
      "テレサ・テン",
      "石川さゆり",
    ]);
  });

  it("只读取年度综合、动漫和 Vocaloid 段落", () => {
    const html = `
      <h2>カラオケ総合ランキング</h2>
      <div><a href="/web/search/song/1">综合</a></div>
      <h2>アニメ／ゲームランキング</h2>
      <div><a href="/web/search/song/2">动漫</a></div>
      <h2>ボカロランキング</h2>
      <div><a href="/web/search/song/3">Vocaloid</a></div>
      <h2>演歌／歌謡曲ランキング</h2>
      <div><a href="/web/search/song/4">演歌</a></div>
    `;

    expect(extractAnnualSongUrls(html)).toEqual({
      general: ["https://www.joysound.com/web/search/song/1"],
      anime: ["https://www.joysound.com/web/search/song/2"],
      vocaloid: ["https://www.joysound.com/web/search/song/3"],
    });
  });

  it("年龄榜只读取 10 至 40 岁，并单独读取歌手热门段落", () => {
    const html = `
      <div id="jp-page-sl-list01">
        <a href="/web/search/song/10">10代</a>
      </div>
      <div id="jp-page-sl-list04">
        <a href="/web/search/song/40">40代</a>
      </div>
      <div id="jp-page-sl-list05">
        <a href="/web/search/song/50">50代</a>
      </div>
      <h2>"测试歌手"の人気曲ランキング</h2>
      <div><a href="/web/search/song/11">热门</a></div>
      <h2>"测试歌手"の最新配信曲</h2>
      <div><a href="/web/search/song/12">最新</a></div>
    `;

    expect(extractAge10To40SongUrls(html)).toEqual([
      "https://www.joysound.com/web/search/song/10",
      "https://www.joysound.com/web/search/song/40",
    ]);
    expect(extractArtistPopularSongUrls(html)).toEqual([
      "https://www.joysound.com/web/search/song/11",
    ]);
  });
});
