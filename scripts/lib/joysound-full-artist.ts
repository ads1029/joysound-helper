export const ARTIST_PAGE_SIZE = 20;

export type FullArtistSeed = {
  artistId: string;
  artistName: string;
  artistUrl: string;
  declaredTotalCount: number;
  plannedPages: number;
};

export type FullArtistPageStatus =
  | "success"
  | "unavailable"
  | "error";

export type FullArtistPageCheckpoint = {
  page: number;
  url: string;
  status: FullArtistPageStatus;
  fetchedAt: string;
  startIndex?: number;
  endIndex?: number;
  candidateUrls: string[];
  importedFrom?: string;
  error?: string;
};

export type FullArtistCheckpointArtist = FullArtistSeed & {
  pages: Record<string, FullArtistPageCheckpoint>;
  successfulPages: number;
  unavailablePages: number;
  errorPages: number;
  pendingPages: number;
  candidateUrls: string[];
};

export type FullArtistDiscoveryCheckpoint = {
  schemaVersion: 1;
  updatedAt: string;
  sourceIndexPath: string;
  artists: Record<string, FullArtistCheckpointArtist>;
};

type ExpandedCandidates = {
  schemaVersion: number;
  sources: Array<{
    id: string;
    url: string;
    parser: string;
    status: string;
    excludedByCategory?: boolean;
    artistName?: string;
    totalCount?: number;
  }>;
};

type ProductionCatalog = {
  songs: Array<{ sourceUrl: string }>;
};

export function extractFullArtistSeeds(
  expandedCandidates: ExpandedCandidates,
): FullArtistSeed[] {
  if (
    expandedCandidates.schemaVersion !== 1 ||
    !Array.isArray(expandedCandidates.sources)
  ) {
    throw new Error("热门歌手扩展索引格式无效或版本不受支持");
  }

  const seeds = expandedCandidates.sources
    .filter(
      (source) =>
        source.parser === "artist-catalog" &&
        source.status === "success" &&
        source.excludedByCategory !== true &&
        source.id.endsWith("-page-1"),
    )
    .map((source) => {
      const artistId = source.url.match(
        /^https:\/\/www\.joysound\.com\/web\/search\/artist\/(\d+)/,
      )?.[1];

      if (
        !artistId ||
        !source.artistName ||
        typeof source.totalCount !== "number" ||
        !Number.isSafeInteger(source.totalCount) ||
        source.totalCount < 1
      ) {
        throw new Error(`歌手首页元数据不完整：${source.id}`);
      }

      return {
        artistId,
        artistName: source.artistName,
        artistUrl:
          `https://www.joysound.com/web/search/artist/${artistId}`,
        declaredTotalCount: source.totalCount,
        plannedPages: Math.ceil(
          source.totalCount / ARTIST_PAGE_SIZE,
        ),
      };
    })
    .sort((first, second) =>
      first.artistId.localeCompare(second.artistId),
    );

  if (new Set(seeds.map((seed) => seed.artistId)).size !== seeds.length) {
    throw new Error("热门歌手扩展索引包含重复歌手首页");
  }

  return seeds;
}

export function createArtistPageUrl(
  artistId: string,
  page: number,
): string {
  return (
    `https://www.joysound.com/web/search/artist/${artistId}` +
    `?sort=popular&page=${page}`
  );
}

export function expectedArtistPageRange(
  seed: FullArtistSeed,
  page: number,
): { startIndex: number; endIndex: number; count: number } {
  if (page < 1 || page > seed.plannedPages) {
    throw new Error(
      `${seed.artistName} 的页码 ${page} 超出 1～${seed.plannedPages}`,
    );
  }

  const startIndex = (page - 1) * ARTIST_PAGE_SIZE + 1;
  const endIndex = Math.min(
    page * ARTIST_PAGE_SIZE,
    seed.declaredTotalCount,
  );

  return {
    startIndex,
    endIndex,
    count: endIndex - startIndex + 1,
  };
}

export function createCheckpointArtist(
  seed: FullArtistSeed,
  saved?: FullArtistCheckpointArtist,
): FullArtistCheckpointArtist {
  const metadataMatches =
    saved?.artistId === seed.artistId &&
    saved.artistName === seed.artistName &&
    saved.artistUrl === seed.artistUrl &&
    saved.declaredTotalCount === seed.declaredTotalCount &&
    saved.plannedPages === seed.plannedPages;

  return summarizeCheckpointArtist({
    ...seed,
    pages: metadataMatches ? saved.pages : {},
    successfulPages: 0,
    unavailablePages: 0,
    errorPages: 0,
    pendingPages: seed.plannedPages,
    candidateUrls: [],
  });
}

export function summarizeCheckpointArtist(
  artist: FullArtistCheckpointArtist,
): FullArtistCheckpointArtist {
  const pages = Object.values(artist.pages).filter(
    (page) => page.page >= 1 && page.page <= artist.plannedPages,
  );
  const successfulPages = pages.filter(
    (page) => page.status === "success",
  );
  const candidateUrls = [
    ...new Set(
      successfulPages.flatMap((page) => page.candidateUrls),
    ),
  ].sort();

  return {
    ...artist,
    successfulPages: successfulPages.length,
    unavailablePages: pages.filter(
      (page) => page.status === "unavailable",
    ).length,
    errorPages: pages.filter(
      (page) => page.status === "error",
    ).length,
    pendingPages: artist.plannedPages - pages.length,
    candidateUrls,
  };
}

export function resetCheckpointArtistTotalCount(
  artist: FullArtistCheckpointArtist,
  declaredTotalCount: number,
): FullArtistCheckpointArtist {
  if (
    !Number.isSafeInteger(declaredTotalCount) ||
    declaredTotalCount < 1
  ) {
    throw new Error(
      `${artist.artistName} 的新声明总数无效：${declaredTotalCount}`,
    );
  }

  return createCheckpointArtist({
    artistId: artist.artistId,
    artistName: artist.artistName,
    artistUrl: artist.artistUrl,
    declaredTotalCount,
    plannedPages: Math.ceil(
      declaredTotalCount / ARTIST_PAGE_SIZE,
    ),
  });
}

export function validateSuccessfulArtistPage(
  seed: FullArtistSeed,
  page: number,
  parsed: {
    totalCount: number;
    startIndex: number;
    endIndex: number;
    songUrls: string[];
  },
) {
  const expected = expectedArtistPageRange(seed, page);

  if (parsed.totalCount !== seed.declaredTotalCount) {
    throw new Error(
      `${seed.artistName} 第 ${page} 页声明总数发生变化：` +
        `${seed.declaredTotalCount} → ${parsed.totalCount}`,
    );
  }
  if (
    parsed.startIndex !== expected.startIndex ||
    parsed.endIndex !== expected.endIndex
  ) {
    throw new Error(
      `${seed.artistName} 第 ${page} 页范围异常：` +
        `${parsed.startIndex}-${parsed.endIndex}，` +
        `预期 ${expected.startIndex}-${expected.endIndex}`,
    );
  }
  if (parsed.songUrls.length !== expected.count) {
    throw new Error(
      `${seed.artistName} 第 ${page} 页解析到 ` +
        `${parsed.songUrls.length} 首，预期 ${expected.count} 首`,
    );
  }
  if (new Set(parsed.songUrls).size !== parsed.songUrls.length) {
    throw new Error(`${seed.artistName} 第 ${page} 页包含重复歌曲链接`);
  }
}

export function createFullArtistCandidateIndex(
  checkpoint: FullArtistDiscoveryCheckpoint,
  productionCatalog: ProductionCatalog,
  generatedAt = new Date().toISOString(),
) {
  if (!Array.isArray(productionCatalog.songs)) {
    throw new Error("生产曲库格式无效");
  }

  const artists = Object.values(checkpoint.artists)
    .map(summarizeCheckpointArtist)
    .sort((first, second) =>
      first.artistId.localeCompare(second.artistId),
    );
  const entrySources = new Map<
    string,
    Array<{
      artistId: string;
      artistName: string;
      page: number;
      rank: number;
    }>
  >();

  for (const artist of artists) {
    for (const page of Object.values(artist.pages)) {
      if (page.status !== "success") {
        continue;
      }

      for (const [index, url] of page.candidateUrls.entries()) {
        const sources = entrySources.get(url) ?? [];
        sources.push({
          artistId: artist.artistId,
          artistName: artist.artistName,
          page: page.page,
          rank: (page.startIndex ?? 1) + index,
        });
        entrySources.set(url, sources);
      }
    }
  }

  const productionUrls = new Set(
    productionCatalog.songs.map((song) => song.sourceUrl),
  );
  const entries = [...entrySources.entries()]
    .map(([url, sources]) => ({
      url,
      alreadyInProductionCatalog: productionUrls.has(url),
      sources: sources.sort(
        (first, second) =>
          first.artistId.localeCompare(second.artistId) ||
          first.rank - second.rank,
      ),
    }))
    .sort((first, second) => first.url.localeCompare(second.url));
  const successfulSourcePages = artists.reduce(
    (count, artist) => count + artist.successfulPages,
    0,
  );
  const unavailableSourcePages = artists.reduce(
    (count, artist) => count + artist.unavailablePages,
    0,
  );
  const errorSourcePages = artists.reduce(
    (count, artist) => count + artist.errorPages,
    0,
  );
  const pendingSourcePages = artists.reduce(
    (count, artist) => count + artist.pendingPages,
    0,
  );
  const inconsistentArtists = artists.filter(
    (artist) =>
      artist.unavailablePages === 0 &&
      artist.errorPages === 0 &&
      artist.pendingPages === 0 &&
      artist.candidateUrls.length !== artist.declaredTotalCount,
  );

  const newEntries = entries.filter(
    (entry) => !entry.alreadyInProductionCatalog,
  );

  return {
    schemaVersion: 1,
    generatedAt,
    sourceIndexPath: checkpoint.sourceIndexPath,
    policy: {
      artistCount: artists.length,
      artistPageSize: ARTIST_PAGE_SIZE,
      artistOrder: "JOYSOUND 歌手曲一覧的人気順",
      scope: "已筛选的 95 位热门歌手全部声明分页",
    },
    discoveryReady:
      pendingSourcePages === 0 &&
      errorSourcePages === 0 &&
      inconsistentArtists.length === 0,
    summary: {
      targetedArtists: artists.length,
      declaredSongEntries: artists.reduce(
        (count, artist) => count + artist.declaredTotalCount,
        0,
      ),
      plannedSourcePages: artists.reduce(
        (count, artist) => count + artist.plannedPages,
        0,
      ),
      successfulSourcePages,
      unavailableSourcePages,
      errorSourcePages,
      pendingSourcePages,
      inconsistentArtists: inconsistentArtists.length,
      discoveredSongReferences: artists.reduce(
        (count, artist) => count + artist.candidateUrls.length,
        0,
      ),
      uniqueSongPages: entries.length,
      alreadyInProductionCatalogPages:
        entries.length - newEntries.length,
      newForProductionPages: newEntries.length,
    },
    artists: artists.map((artist) => ({
      artistId: artist.artistId,
      artistName: artist.artistName,
      artistUrl: artist.artistUrl,
      declaredTotalCount: artist.declaredTotalCount,
      plannedPages: artist.plannedPages,
      successfulPages: artist.successfulPages,
      unavailablePages: artist.unavailablePages,
      errorPages: artist.errorPages,
      pendingPages: artist.pendingPages,
      candidateCount: artist.candidateUrls.length,
      ...(inconsistentArtists.some(
        (inconsistent) =>
          inconsistent.artistId === artist.artistId,
      )
        ? {
            inconsistency:
              `候选 ${artist.candidateUrls.length}/` +
              `声明 ${artist.declaredTotalCount}`,
          }
        : {}),
    })),
    entries,
  };
}
