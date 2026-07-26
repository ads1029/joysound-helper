import { load } from "cheerio";

const SONG_PATH_PATTERN = /^\/web\/search\/song\/\d+$/;
const ARTIST_PATH_PATTERN = /^\/web\/search\/artist\/\d+$/;

export type RankingSection =
  | "general"
  | "anime"
  | "vocaloid"
  | "released"
  | "age-10-40"
  | "popular-artist"
  | "popular-artist-expanded"
  | "heisei-1996-2011";

export type ArtistCatalogPage = {
  totalCount: number;
  startIndex: number;
  endIndex: number;
  songUrls: string[];
};

export function extractAllSongUrls(html: string): string[] {
  return uniqueOfficialUrls(
    [...html.matchAll(/\/web\/search\/song\/\d+/g)].map(
      (match) => match[0],
    ),
    SONG_PATH_PATTERN,
  );
}

export function extractArtistUrls(html: string): string[] {
  return uniqueOfficialUrls(
    [...html.matchAll(/\/web\/search\/artist\/\d+/g)].map(
      (match) => match[0],
    ),
    ARTIST_PATH_PATTERN,
  );
}

export function extractAnnualSongUrls(
  html: string,
): Record<"general" | "anime" | "vocaloid", string[]> {
  const $ = load(html);

  return {
    general: extractHeadingSectionUrls(
      $,
      (title) => title === "カラオケ総合ランキング",
    ),
    anime: extractHeadingSectionUrls(
      $,
      (title) =>
        /アニメ.*(?:ゲーム)?ランキング/.test(title),
    ),
    vocaloid: extractHeadingSectionUrls(
      $,
      (title) =>
        /(?:VOCALOID|ボカロ).*ランキング/.test(title),
    ),
  };
}

export function extractAge10To40SongUrls(html: string): string[] {
  const $ = load(html);
  const paths: string[] = [];

  for (const suffix of ["01", "02", "03", "04"]) {
    $(`#jp-page-sl-list${suffix} a[href*='/web/search/song/']`).each(
      (_, element) => {
        paths.push($(element).attr("href") ?? "");
      },
    );
  }

  return uniqueOfficialUrls(paths, SONG_PATH_PATTERN);
}

export function extractArtistPopularSongUrls(html: string): string[] {
  const $ = load(html);

  return extractHeadingSectionUrls(
    $,
    (title) => title.includes("人気曲ランキング"),
  );
}

export function extractArtistCatalogPage(
  html: string,
): ArtistCatalogPage {
  const $ = load(html);
  let result: ArtistCatalogPage = {
    totalCount: 0,
    startIndex: 0,
    endIndex: 0,
    songUrls: [],
  };

  $("h2").each((_, heading) => {
    const title = $(heading).text().replace(/\s+/g, "").trim();
    const match = title.match(/^(\d+)件\((\d+)-(\d+)件目表示\)$/);

    if (!match) {
      return;
    }

    const section = $(heading).closest("section");
    const paths = section
      .find("a[href*='/web/search/song/']")
      .map((__, element) => $(element).attr("href") ?? "")
      .get();

    result = {
      totalCount: Number(match[1]),
      startIndex: Number(match[2]),
      endIndex: Number(match[3]),
      songUrls: uniqueOfficialUrls(paths, SONG_PATH_PATTERN, false),
    };
  });

  return result;
}

export function extractHeiseiYearSongUrls(
  html: string,
  years: number[],
): Record<string, string[]> {
  const $ = load(html);

  return Object.fromEntries(
    years.map((year) => {
      const paths = $(`#ranking-${year}`)
        .find("a[href*='/web/search/song/']")
        .map((_, element) => $(element).attr("href") ?? "")
        .get();

      return [
        String(year),
        uniqueOfficialUrls(paths, SONG_PATH_PATTERN),
      ];
    }),
  );
}

export function extractCategoryRankingArtistUrls(
  html: string,
  headingPattern: RegExp,
): string[] {
  const $ = load(html);

  return extractHeadingSectionUrls(
    $,
    (title) => headingPattern.test(title),
    ARTIST_PATH_PATTERN,
  );
}

export function extractRankingArtistNames(html: string): string[] {
  const escapedNames = [
    ...html.matchAll(
      /\\"artistName\\":\\"(.*?)\\"/g,
    ),
  ].map((match) => decodeJsonString(match[1] ?? ""));
  const plainNames = [
    ...html.matchAll(
      /"artistName":"(.*?)"/g,
    ),
  ].map((match) => decodeJsonString(match[1] ?? ""));

  return [...new Set([...escapedNames, ...plainNames])]
    .filter(Boolean)
    .sort();
}

function extractHeadingSectionUrls(
  $: ReturnType<typeof load>,
  matchesHeading: (title: string) => boolean,
  pathPattern = SONG_PATH_PATTERN,
): string[] {
  const paths: string[] = [];

  $("h2").each((_, heading) => {
    const title = $(heading).text().replace(/\s+/g, " ").trim();

    if (!matchesHeading(title)) {
      return;
    }

    let sibling = $(heading).next();

    while (sibling.length > 0 && sibling[0]?.tagName !== "h2") {
      sibling.find("a[href]").each(
        (_, element) => {
          const path = $(element).attr("href") ?? "";

          if (pathPattern.test(path.split(/[?#]/, 1)[0] ?? "")) {
            paths.push(path);
          }
        },
      );
      sibling = sibling.next();
    }
  });

  return uniqueOfficialUrls(paths, pathPattern);
}

function uniqueOfficialUrls(
  paths: string[],
  pattern: RegExp,
  sort = true,
): string[] {
  const urls = [
    ...new Set(
      paths
        .map((path) => path.split(/[?#]/, 1)[0] ?? "")
        .filter((path) => pattern.test(path))
        .map((path) => `https://www.joysound.com${path}`),
    ),
  ];

  return sort ? urls.sort() : urls;
}

function decodeJsonString(value: string): string {
  try {
    return JSON.parse(`"${value}"`) as string;
  } catch {
    return value;
  }
}
