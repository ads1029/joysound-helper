import type { Song, SongVariant } from "../../src/types";

export type CrawlStatus = "success" | "no-x1" | "unavailable" | "error";

export type CrawlCheckpointItem = {
  status: CrawlStatus;
  sourceLastModified?: string;
  attemptedAt: string;
  error?: string;
  song?: Song;
};

export type CrawlCheckpoint = {
  schemaVersion: number;
  sitemapUrl: string;
  updatedAt: string;
  items: Record<string, CrawlCheckpointItem>;
};

export type CatalogConflict = {
  kind:
    | "checkpoint"
    | "song-id"
    | "song-metadata"
    | "song-number"
    | "variant-id"
    | "variant-metadata";
  key: string;
  message: string;
  sourceUrls: string[];
};

export type CatalogMergeResult = {
  songs: Song[];
  conflicts: CatalogConflict[];
  stats: {
    productionSongs: number;
    productionVariants: number;
    generatedSongs: number;
    generatedVariants: number;
    newSongs: number;
    overlappingSongs: number;
    addedVariants: number;
    mergedSongs: number;
    mergedVariants: number;
  };
};

export type CatalogSnapshot = {
  schemaVersion: 1;
  generatedAt: string;
  sitemapUrl: string;
  crawlReady: boolean;
  summary: CatalogMergeResult["stats"] & {
    indexedCandidates: number;
    processedCandidates: number;
    pendingCandidates: number;
    completionPercent: number;
    successPages: number;
    noX1Pages: number;
    unavailablePages: number;
    errorPages: number;
    conflictCount: number;
  };
  statusItems: {
    success: string[];
    noX1: string[];
    unavailable: StatusDetail[];
    error: StatusDetail[];
    pending: string[];
    outsideIndex: string[];
  };
  conflicts: CatalogConflict[];
  songs: Song[];
};

type StatusDetail = {
  sourceUrl: string;
  error?: string;
};

type SitemapInput = {
  sitemapUrl: string;
  entries: Array<{ url: string }>;
};

export function createCatalogSnapshot(
  index: SitemapInput,
  checkpoint: CrawlCheckpoint,
  productionSongs: Song[],
  generatedAt = new Date().toISOString(),
): CatalogSnapshot {
  const statusItems: CatalogSnapshot["statusItems"] = {
    success: [],
    noX1: [],
    unavailable: [],
    error: [],
    pending: [],
    outsideIndex: [],
  };
  const checkpointConflicts: CatalogConflict[] = [];
  const generatedSongs: Song[] = [];
  const indexedUrls = new Set(index.entries.map((entry) => entry.url));

  for (const entry of index.entries) {
    const item = checkpoint.items[entry.url];

    if (!item) {
      statusItems.pending.push(entry.url);
      continue;
    }

    if (item.status === "success") {
      statusItems.success.push(entry.url);

      if (!item.song) {
        checkpointConflicts.push({
          kind: "checkpoint",
          key: entry.url,
          message: "检查点状态为 success，但没有歌曲数据",
          sourceUrls: [entry.url],
        });
      } else if (item.song.sourceUrl !== entry.url) {
        checkpointConflicts.push({
          kind: "checkpoint",
          key: entry.url,
          message: `检查点链接与歌曲来源不一致：${item.song.sourceUrl}`,
          sourceUrls: [entry.url, item.song.sourceUrl],
        });
      } else {
        generatedSongs.push(item.song);
      }
    } else if (item.status === "no-x1") {
      statusItems.noX1.push(entry.url);
    } else if (item.status === "unavailable") {
      statusItems.unavailable.push(toStatusDetail(entry.url, item.error));
    } else if (item.status === "error") {
      statusItems.error.push(toStatusDetail(entry.url, item.error));
    } else {
      checkpointConflicts.push({
        kind: "checkpoint",
        key: entry.url,
        message: `检查点包含未知状态：${String(item.status)}`,
        sourceUrls: [entry.url],
      });
    }
  }

  statusItems.outsideIndex = Object.keys(checkpoint.items)
    .filter((url) => !indexedUrls.has(url))
    .sort();

  for (const url of statusItems.outsideIndex) {
    checkpointConflicts.push({
      kind: "checkpoint",
      key: url,
      message: "检查点包含候选索引之外的歌曲页面",
      sourceUrls: [url],
    });
  }

  const mergeResult = mergeSongCatalog(productionSongs, generatedSongs);
  const conflicts = [...checkpointConflicts, ...mergeResult.conflicts];
  const processedCandidates =
    statusItems.success.length +
    statusItems.noX1.length +
    statusItems.unavailable.length +
    statusItems.error.length;
  const indexedCandidates = index.entries.length;
  const completionPercent =
    indexedCandidates === 0
      ? 100
      : Math.round((processedCandidates / indexedCandidates) * 10_000) / 100;

  return {
    schemaVersion: 1,
    generatedAt,
    sitemapUrl: index.sitemapUrl,
    crawlReady:
      statusItems.pending.length === 0 &&
      statusItems.error.length === 0 &&
      conflicts.length === 0,
    summary: {
      indexedCandidates,
      processedCandidates,
      pendingCandidates: statusItems.pending.length,
      completionPercent,
      successPages: statusItems.success.length,
      noX1Pages: statusItems.noX1.length,
      unavailablePages: statusItems.unavailable.length,
      errorPages: statusItems.error.length,
      conflictCount: conflicts.length,
      ...mergeResult.stats,
    },
    statusItems,
    conflicts,
    songs: mergeResult.songs,
  };
}

export function mergeSongCatalog(
  productionSongs: Song[],
  generatedSongs: Song[],
): CatalogMergeResult {
  const songs = productionSongs.map(cloneSong);
  const conflicts: CatalogConflict[] = [];
  const songsBySourceUrl = new Map(songs.map((song) => [song.sourceUrl, song]));
  const songsById = new Map(songs.map((song) => [song.id, song]));
  const variantsById = new Map<string, { song: Song; variant: SongVariant }>();
  const variantsByNumber = new Map<
    string,
    { song: Song; variant: SongVariant }
  >();
  let newSongs = 0;
  let overlappingSongs = 0;
  let addedVariants = 0;

  for (const song of songs) {
    indexVariants(song, variantsById, variantsByNumber);
  }

  for (const generatedSong of generatedSongs) {
    const existingSong = songsBySourceUrl.get(generatedSong.sourceUrl);

    if (existingSong) {
      overlappingSongs += 1;

      if (
        existingSong.title !== generatedSong.title ||
        existingSong.artist !== generatedSong.artist
      ) {
        conflicts.push({
          kind: "song-metadata",
          key: generatedSong.sourceUrl,
          message:
            `同一来源的歌名或歌手不一致：` +
            `${existingSong.title} / ${existingSong.artist} ↔ ` +
            `${generatedSong.title} / ${generatedSong.artist}`,
          sourceUrls: [generatedSong.sourceUrl],
        });
        continue;
      }

      for (const variant of generatedSong.variants) {
        if (
          addVariant(
            existingSong,
            variant,
            variantsById,
            variantsByNumber,
            conflicts,
          )
        ) {
          addedVariants += 1;
        }
      }
      continue;
    }

    const songWithSameId = songsById.get(generatedSong.id);

    if (songWithSameId) {
      conflicts.push({
        kind: "song-id",
        key: generatedSong.id,
        message: "歌曲 ID 指向不同来源页面",
        sourceUrls: [songWithSameId.sourceUrl, generatedSong.sourceUrl],
      });
      continue;
    }

    const newSong: Song = {
      ...generatedSong,
      variants: [],
    };

    for (const variant of generatedSong.variants) {
      if (
        addVariant(
          newSong,
          variant,
          variantsById,
          variantsByNumber,
          conflicts,
        )
      ) {
        addedVariants += 1;
      }
    }

    if (newSong.variants.length === 0) {
      continue;
    }

    songs.push(newSong);
    songsBySourceUrl.set(newSong.sourceUrl, newSong);
    songsById.set(newSong.id, newSong);
    newSongs += 1;
  }

  songs.sort((first, second) =>
    first.sourceUrl.localeCompare(second.sourceUrl),
  );

  return {
    songs,
    conflicts,
    stats: {
      productionSongs: productionSongs.length,
      productionVariants: countVariants(productionSongs),
      generatedSongs: generatedSongs.length,
      generatedVariants: countVariants(generatedSongs),
      newSongs,
      overlappingSongs,
      addedVariants,
      mergedSongs: songs.length,
      mergedVariants: countVariants(songs),
    },
  };
}

function addVariant(
  targetSong: Song,
  variant: SongVariant,
  variantsById: Map<string, { song: Song; variant: SongVariant }>,
  variantsByNumber: Map<string, { song: Song; variant: SongVariant }>,
  conflicts: CatalogConflict[],
): boolean {
  const sameNumber = variantsByNumber.get(variant.songNumber);

  if (sameNumber) {
    const sameSource = sameNumber.song.sourceUrl === targetSong.sourceUrl;

    if (sameSource && hasSameVariantMetadata(sameNumber.variant, variant)) {
      return false;
    }

    conflicts.push({
      kind: sameSource ? "variant-metadata" : "song-number",
      key: variant.songNumber,
      message: sameSource
        ? "同一曲号的版本元数据不一致"
        : "同一曲号出现在不同歌曲来源中",
      sourceUrls: [sameNumber.song.sourceUrl, targetSong.sourceUrl],
    });
    return false;
  }

  const sameId = variantsById.get(variant.id);

  if (sameId) {
    conflicts.push({
      kind: "variant-id",
      key: variant.id,
      message: "版本 ID 指向不同曲号",
      sourceUrls: [sameId.song.sourceUrl, targetSong.sourceUrl],
    });
    return false;
  }

  const clonedVariant = { ...variant };
  targetSong.variants.push(clonedVariant);
  variantsById.set(clonedVariant.id, {
    song: targetSong,
    variant: clonedVariant,
  });
  variantsByNumber.set(clonedVariant.songNumber, {
    song: targetSong,
    variant: clonedVariant,
  });
  return true;
}

function indexVariants(
  song: Song,
  variantsById: Map<string, { song: Song; variant: SongVariant }>,
  variantsByNumber: Map<string, { song: Song; variant: SongVariant }>,
) {
  for (const variant of song.variants) {
    variantsById.set(variant.id, { song, variant });
    variantsByNumber.set(variant.songNumber, { song, variant });
  }
}

function hasSameVariantMetadata(
  first: SongVariant,
  second: SongVariant,
): boolean {
  return (
    first.songNumber === second.songNumber &&
    first.versionTitle === second.versionTitle &&
    first.versionType === second.versionType &&
    first.supportsX1 === second.supportsX1
  );
}

function countVariants(songs: Song[]): number {
  return songs.reduce((count, song) => count + song.variants.length, 0);
}

function cloneSong(song: Song): Song {
  return {
    ...song,
    variants: song.variants.map((variant) => ({ ...variant })),
  };
}

function toStatusDetail(
  sourceUrl: string,
  error: string | undefined,
): StatusDetail {
  return {
    sourceUrl,
    ...(error ? { error } : {}),
  };
}
