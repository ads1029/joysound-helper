import type { Song, SongVariant, VersionType } from "../types";
import {
  normalizeKanjiOnlyText,
  normalizeSearchText,
} from "./normalize";

const VERSION_PRIORITY: Record<VersionType, number> = {
  standard: 1,
  "official-video": 2,
  "anime-video": 3,
  "guide-vocal": 4,
  "guitar-guide": 5,
  other: 6,
};

export type SearchResult = Omit<Song, "variants"> & {
  variants: SongVariant[];
};

export const CATALOG_PAGE_SIZE = 10;

const romajiCollator = new Intl.Collator("en", {
  numeric: true,
  sensitivity: "base",
});

function toSearchResult(song: Song): SearchResult | null {
  const variants = song.variants
    .filter((variant) => variant.supportsX1)
    .sort(
      (first, second) =>
        VERSION_PRIORITY[first.versionType] -
        VERSION_PRIORITY[second.versionType],
    );

  if (variants.length === 0) {
    return null;
  }

  return {
    ...song,
    variants,
  };
}

export function listSongsByRomaji(allSongs: Song[]): SearchResult[] {
  return allSongs
    .map(toSearchResult)
    .filter((song): song is SearchResult => song !== null)
    .sort((first, second) => {
      const firstSortName = first.romaji?.trim() || first.title;
      const secondSortName = second.romaji?.trim() || second.title;
      const romajiOrder = romajiCollator.compare(
        firstSortName,
        secondSortName,
      );

      return romajiOrder || first.title.localeCompare(second.title, "ja");
    });
}

export function searchSongs(
  allSongs: Song[],
  rawQuery: string,
): SearchResult[] {
  const query = normalizeSearchText(rawQuery);

  if (!query) {
    return [];
  }

  const exactMatches = allSongs.filter(
    (song) => normalizeSearchText(song.title) === query,
  );

  if (exactMatches.length > 0) {
    return exactMatches
      .map(toSearchResult)
      .filter((song): song is SearchResult => song !== null);
  }

  // 宽松匹配忽略长音符，使标题中的“～”和用户输入的“ー”等价。
  const partialQuery = query.replace(/ー/g, "");

  if (Array.from(partialQuery).length < 2) {
    return [];
  }

  const kanjiQuery = normalizeKanjiOnlyText(rawQuery);
  const canUseKanjiOnlySearch =
    Array.from(kanjiQuery).length >= 2 && kanjiQuery === query;
  // 完整歌名优先；片段搜索至少需要两个字符，避免单字查询返回过多结果。
  const matchedSongs = allSongs.filter((song) => {
    const normalizedTitle = normalizeSearchText(song.title);
    const matchesPartialTitle = normalizedTitle
      .replace(/ー/g, "")
      .includes(partialQuery);
    const matchesKanjiOnlyTitle =
      canUseKanjiOnlySearch &&
      normalizeKanjiOnlyText(song.title).includes(kanjiQuery);

    return matchesPartialTitle || matchesKanjiOnlyTitle;
  });

  return matchedSongs
    .map(toSearchResult)
    .filter((song): song is SearchResult => song !== null);
}

export function searchSongsByArtist(
  allSongs: Song[],
  rawQuery: string,
): SearchResult[] {
  const query = normalizeSearchText(rawQuery).replace(/ー/g, "");

  if (!query) {
    return [];
  }

  const exactMatches: Song[] = [];
  const partialMatches: Song[] = [];
  const canUsePartialSearch = Array.from(query).length >= 2;

  allSongs.forEach((song) => {
    const normalizedArtist = normalizeSearchText(song.artist).replace(
      /ー/g,
      "",
    );

    if (normalizedArtist === query) {
      exactMatches.push(song);
    } else if (
      canUsePartialSearch &&
      normalizedArtist.includes(query)
    ) {
      partialMatches.push(song);
    }
  });

  return [...exactMatches, ...partialMatches]
    .map(toSearchResult)
    .filter((song): song is SearchResult => song !== null);
}
