import type { Song, SongVariant, VersionType } from "../types";
import { normalizeSearchText } from "./normalize";

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

  return allSongs
    .filter((song) => normalizeSearchText(song.title) === query)
    .map(toSearchResult)
    .filter((song): song is SearchResult => song !== null);
}
