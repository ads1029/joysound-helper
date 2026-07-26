import { load } from "cheerio";

import type { Song, VersionType } from "../../src/types";

export type SitemapEntry = {
  url: string;
  lastModified?: string;
};

type JsonLdRecord = {
  "@type"?: string;
  "@graph"?: JsonLdRecord[];
  name?: string;
  byArtist?: JsonLdRecord | JsonLdRecord[];
};

const SONG_URL_PATTERN =
  /^https:\/\/www\.joysound\.com\/web\/search\/song\/(\d+)$/;

export function parseSitemapXml(xml: string): SitemapEntry[] {
  const $ = load(xml, { xmlMode: true });
  const entries: SitemapEntry[] = [];

  $("url").each((_, element) => {
    const url = $(element).find("loc").first().text().trim();
    const lastModified = $(element).find("lastmod").first().text().trim();

    if (!SONG_URL_PATTERN.test(url)) {
      return;
    }

    entries.push({
      url,
      ...(lastModified ? { lastModified } : {}),
    });
  });

  return entries;
}

export function parseJoysoundSongPage(
  html: string,
  sourceUrl: string,
): Song {
  const pageId = sourceUrl.match(SONG_URL_PATTERN)?.[1];

  if (!pageId) {
    throw new Error(`不是有效的 JOYSOUND 歌曲链接：${sourceUrl}`);
  }

  const $ = load(html);
  const recording = findMusicRecording(
    $("script[type='application/ld+json']")
      .toArray()
      .map((element) => $(element).text()),
  );
  const musicVideoMetadata = readMusicVideoMetadata(
    $("title").first().text().trim(),
  );
  const title =
    recording?.name?.trim() ||
    musicVideoMetadata?.title ||
    $("h1").first().text().trim();
  const artist =
    readArtistName(recording?.byArtist) ||
    musicVideoMetadata?.artist ||
    readArtistFromTable(html);

  if (!title || !artist) {
    throw new Error(`无法解析歌曲标题或歌手：${sourceUrl}`);
  }

  const variantsByNumber = new Map<string, Song["variants"][number]>();

  $("div[data-testid='card-information']").each((_, element) => {
    const card = $(element);
    const cardText = card.text().replace(/\s+/g, " ").trim();

    if (!cardText.includes("JOYSOUND X1")) {
      return;
    }

    const songNumber = cardText.match(/曲番号\s*:\s*(\d+)/)?.[1];
    const versionTitle = card.find("p").first().text().trim();

    if (!songNumber || !versionTitle || variantsByNumber.has(songNumber)) {
      return;
    }

    variantsByNumber.set(songNumber, {
      id: `joysound-${pageId}-${songNumber}`,
      songNumber,
      versionTitle,
      versionType: detectVersionType(title, versionTitle),
      supportsX1: true,
    });
  });

  return {
    id: `joysound-${pageId}`,
    title,
    artist,
    sourceUrl,
    variants: [...variantsByNumber.values()],
  };
}

function readMusicVideoMetadata(
  pageTitle: string,
): { title: string; artist: string } | undefined {
  const match = pageTitle.match(
    /^\[ミュージックビデオ観放題\](.+)／(.+)-楽曲検索 \| JOYSOUND\.com$/,
  );

  if (!match) {
    return undefined;
  }

  return {
    title: match[1].trim(),
    artist: match[2].trim(),
  };
}

export function validateCrawlSongs(songs: Song[]): string[] {
  const errors: string[] = [];
  const songIds = new Set<string>();
  const sourceUrls = new Set<string>();
  const variantIds = new Set<string>();
  const songNumbers = new Set<string>();

  for (const song of songs) {
    if (!song.title.trim() || !song.artist.trim()) {
      errors.push(`${song.sourceUrl} 缺少歌名或歌手`);
    }

    if (!SONG_URL_PATTERN.test(song.sourceUrl)) {
      errors.push(`${song.sourceUrl} 不是有效的 JOYSOUND 歌曲链接`);
    }

    if (songIds.has(song.id)) {
      errors.push(`歌曲 ID 重复：${song.id}`);
    }
    songIds.add(song.id);

    if (sourceUrls.has(song.sourceUrl)) {
      errors.push(`歌曲来源重复：${song.sourceUrl}`);
    }
    sourceUrls.add(song.sourceUrl);

    for (const variant of song.variants) {
      if (!/^\d+$/.test(variant.songNumber)) {
        errors.push(`曲号不是数字：${variant.songNumber}`);
      }
      if (!variant.supportsX1) {
        errors.push(`误收非 X1 版本：${variant.id}`);
      }
      if (variantIds.has(variant.id)) {
        errors.push(`版本 ID 重复：${variant.id}`);
      }
      if (songNumbers.has(variant.songNumber)) {
        errors.push(`曲号重复：${variant.songNumber}`);
      }

      variantIds.add(variant.id);
      songNumbers.add(variant.songNumber);
    }
  }

  return errors;
}

function findMusicRecording(jsonLdScripts: string[]): JsonLdRecord | undefined {
  for (const script of jsonLdScripts) {
    try {
      const parsed = JSON.parse(script) as JsonLdRecord;
      const records = parsed["@graph"] ?? [parsed];
      const recording = records.find(
        (record) => record["@type"] === "MusicRecording",
      );

      if (recording) {
        return recording;
      }
    } catch {
      continue;
    }
  }

  return undefined;
}

function readArtistName(
  artist: JsonLdRecord | JsonLdRecord[] | undefined,
): string {
  if (Array.isArray(artist)) {
    return artist
      .map((item) => item.name?.trim())
      .filter((name): name is string => Boolean(name))
      .join("、");
  }

  return artist?.name?.trim() ?? "";
}

function readArtistFromTable(html: string): string {
  const $ = load(html);
  const artistRow = $("th")
    .filter((_, element) => $(element).text().trim() === "歌手名")
    .first()
    .closest("tr");

  return artistRow.find("td").first().text().trim();
}

function detectVersionType(
  songTitle: string,
  versionTitle: string,
): VersionType {
  if (versionTitle.includes("本人映像")) {
    return "official-video";
  }
  if (versionTitle.includes("アニメカラオケ")) {
    return "anime-video";
  }
  if (versionTitle.includes("ガイドボーカル")) {
    return "guide-vocal";
  }
  if (versionTitle.includes("ギタナビ")) {
    return "guitar-guide";
  }
  if (versionTitle === songTitle) {
    return "standard";
  }

  return "other";
}
