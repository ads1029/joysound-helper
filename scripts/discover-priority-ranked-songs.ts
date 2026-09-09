import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { load } from "cheerio";

import {
  extractArtistCatalogPage,
  extractAge10To40SongUrls,
  extractRankingArtistNames,
} from "./lib/joysound-ranking";
import { filterByMinimumYear } from "./lib/priority-year";

const OUTPUT_PATH =
  "src/data/generated/joysound-priority-ranked-candidates.json";
const CHECKPOINT_PATH =
  ".cache/joysound-priority-ranking/checkpoint.json";
const PRODUCTION_CATALOG_PATH =
  "src/data/generated/joysound-production-catalog.json";
const FULL_ARTIST_INDEX_PATH =
  "src/data/generated/joysound-full-artist-candidates.json";
const ARTIST_PAGE_SIZE = 20;
const DEFAULT_TARGET_PAGES = 10_000;
const DEFAULT_ARTIST_LIMIT = 100;
const CURRENT_RANKING_YEAR = 2026;
const DELAY_MS = 5_000;
const JITTER_MS = 2_000;
const BATCH_SIZE = 50;
const MINIMUM_BATCH_PAUSE_MS = 45_000;
const MAXIMUM_BATCH_PAUSE_MS = 60_000;

type Category = "acg" | "pop";

type SeedSource = {
  id: string;
  label: string;
  url: string;
  parser: "ranking" | "annual" | "released" | "age" | "exclude";
  category?: Category;
  year?: number;
  yearKind?: "ranking" | "release";
};

type Candidate = {
  url: string;
  category: Category;
  priority: number;
  sourceIds: string[];
  rank?: number;
  year?: number;
  artistId?: string;
  artistName?: string;
  yearKind?: "ranking" | "release";
};

type ParsedSource = {
  source: SeedSource;
  status: "success" | "unavailable";
  fetchedAt: string;
  songCandidates: Array<{
    url: string;
    category: Category;
    rank: number;
    year?: number;
    yearKind?: "ranking" | "release";
  }>;
  artistUrls: string[];
  excludedArtistNames: string[];
  error?: string;
};

type ParsedArtistPage = {
  source: {
    id: string;
    url: string;
    artistId: string;
    page: number;
    limit: number;
  };
  status: "success" | "unavailable";
  fetchedAt: string;
  artistName?: string;
  totalCount?: number;
  songCandidates: Array<{
    url: string;
    rank: number;
  }>;
  error?: string;
};

type Checkpoint = {
  schemaVersion: 1;
  updatedAt: string;
  items: Record<string, ParsedSource | ParsedArtistPage>;
};

type ProductionCatalog = {
  songs: Array<{ sourceUrl: string }>;
};

type FullArtistCandidateIndex = {
  entries: Array<{
    url: string;
    sources: Array<{
      artistId: string;
      artistName: string;
      rank?: number;
    }>;
  }>;
};

type ArtistSeed = {
  url: string;
  artistId: string;
  priority: number;
  categories: Set<Category>;
  sourceIds: Set<string>;
  year?: number;
  yearKind?: "ranking" | "release";
};

type CliOptions = {
  targetPages: number;
  artistLimit: number;
  outputPath: string;
  checkpointPath: string;
  excludeIndexPaths: string[];
  minimumYear?: number;
  newOnly: boolean;
  refresh: boolean;
  confirmAuthorizedDiscovery: boolean;
  help: boolean;
};

class HttpStatusError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function main() {
  const options = parseOptions(process.argv.slice(2));

  if (options.help) {
    printHelp();
    return;
  }

  if (!options.confirmAuthorizedDiscovery) {
    throw new Error(
      "优先榜单发现会低速读取多个官方入口；确认授权后请添加 --confirm-authorized-discovery",
    );
  }

  const productionCatalog = await readJson<ProductionCatalog>(
    PRODUCTION_CATALOG_PATH,
  );
  const excludedUrls = await readExcludedUrls(options.excludeIndexPaths);
  const fullArtistIndex = await readJson<FullArtistCandidateIndex>(
    FULL_ARTIST_INDEX_PATH,
  );
  const checkpoint = await loadCheckpoint(options.checkpointPath);
  const requestState = { count: 0, lastRequestAt: 0 };
  const parsedSources: ParsedSource[] = [];
  const excludedArtistNames = new Set<string>();

  for (const source of createExcludeSources()) {
    const parsed = await loadOrFetchSource(
      source,
      checkpoint,
      requestState,
      options.refresh,
      options.checkpointPath,
    );
    parsedSources.push(parsed);
    for (const name of parsed.excludedArtistNames) {
      excludedArtistNames.add(name);
    }
  }

  for (const source of createRankingSources(options.minimumYear)) {
    const parsed = await loadOrFetchSource(
      source,
      checkpoint,
      requestState,
      options.refresh,
      options.checkpointPath,
    );
    parsedSources.push(parsed);
  }

  const artistSeeds = createArtistSeeds(parsedSources);
  const existingArtistIds = new Set(
    fullArtistIndex.entries.flatMap((entry) =>
      entry.sources.map((source) => source.artistId),
    ),
  );
  const candidates: Candidate[] = [];

  for (const parsed of parsedSources) {
    for (const song of parsed.songCandidates) {
      candidates.push({
        url: song.url,
        category: song.category,
        priority: sourcePriority(
          parsed.source,
          song.rank,
          song.year,
          song.category,
        ),
        sourceIds: [parsed.source.id],
        rank: song.rank,
        year: song.year,
        yearKind: song.yearKind,
      });
    }
  }

  addExistingArtistCandidates(
    candidates,
    fullArtistIndex,
    artistSeeds,
    options.artistLimit,
  );

  for (const artist of [...artistSeeds.values()].sort(compareArtistSeeds)) {
    if (existingArtistIds.has(artist.artistId)) {
      continue;
    }

    const firstPage = await loadOrFetchArtistPage(
      artist,
      1,
      options.artistLimit,
      checkpoint,
      requestState,
      options.refresh,
      options.checkpointPath,
    );

    if (
      firstPage.status !== "success" ||
      !firstPage.artistName ||
      excludedArtistNames.has(firstPage.artistName)
    ) {
      continue;
    }

    addArtistPageCandidates(candidates, firstPage, artist);

    const totalCount = firstPage.totalCount ?? 0;
    const pageCount = Math.min(
      Math.ceil(totalCount / ARTIST_PAGE_SIZE),
      Math.ceil(options.artistLimit / ARTIST_PAGE_SIZE),
    );

    for (let page = 2; page <= pageCount; page += 1) {
      const parsed = await loadOrFetchArtistPage(
        artist,
        page,
        options.artistLimit,
        checkpoint,
        requestState,
        options.refresh,
        options.checkpointPath,
      );
      if (parsed.status === "success") {
        addArtistPageCandidates(candidates, parsed, artist);
      }
    }
  }

  const productionUrls = new Set(
    productionCatalog.songs.map((song) => song.sourceUrl),
  );
  const entries = mergeAndSelectCandidates(
    candidates,
    productionUrls,
    excludedUrls,
    options.targetPages,
    options.newOnly,
    options.minimumYear,
  );
  const output = createOutput(
    entries,
    parsedSources,
    artistSeeds,
    options,
  );

  await writeJsonAtomic(options.outputPath, output);
  printSummary(output, options.outputPath);
}

function createExcludeSources(): SeedSource[] {
  return [
    {
      id: "priority-excluded-enka-weekly",
      label: "演歌周榜排除歌手",
      url: "https://www.joysound.com/web/karaoke/ranking/enka/weekly",
      parser: "exclude",
    },
    {
      id: "priority-excluded-enka-monthly",
      label: "演歌月榜排除歌手",
      url: "https://www.joysound.com/web/karaoke/ranking/enka/monthly",
      parser: "exclude",
    },
    {
      id: "priority-excluded-foreign-weekly",
      label: "洋乐周榜排除歌手",
      url: "https://www.joysound.com/web/karaoke/ranking/foreign/weekly",
      parser: "exclude",
    },
    {
      id: "priority-excluded-foreign-monthly",
      label: "洋乐月榜排除歌手",
      url: "https://www.joysound.com/web/karaoke/ranking/foreign/monthly",
      parser: "exclude",
    },
  ];
}

function createRankingSources(minimumYear: number | undefined): SeedSource[] {
  const sources: SeedSource[] = [
    {
      id: "priority-current-anime-weekly",
      label: "当前动漫周榜",
      url: "https://www.joysound.com/web/karaoke/ranking/anime/weekly",
      parser: "ranking",
      category: "acg",
      year: CURRENT_RANKING_YEAR,
      yearKind: "ranking",
    },
    {
      id: "priority-current-anime-monthly",
      label: "当前动漫月榜",
      url: "https://www.joysound.com/web/karaoke/ranking/anime/monthly",
      parser: "ranking",
      category: "acg",
      year: CURRENT_RANKING_YEAR,
      yearKind: "ranking",
    },
    {
      id: "priority-current-vocaloid-weekly",
      label: "当前 Vocaloid 周榜",
      url: "https://www.joysound.com/web/karaoke/ranking/vocaloid/weekly",
      parser: "ranking",
      category: "acg",
      year: CURRENT_RANKING_YEAR,
      yearKind: "ranking",
    },
    {
      id: "priority-current-vocaloid-monthly",
      label: "当前 Vocaloid 月榜",
      url: "https://www.joysound.com/web/karaoke/ranking/vocaloid/monthly",
      parser: "ranking",
      category: "acg",
      year: CURRENT_RANKING_YEAR,
      yearKind: "ranking",
    },
    {
      id: "priority-current-general-daily",
      label: "当前综合日榜",
      url: "https://www.joysound.com/web/karaoke/ranking/all",
      parser: "ranking",
      category: "pop",
      year: CURRENT_RANKING_YEAR,
      yearKind: "ranking",
    },
    {
      id: "priority-current-general-weekly",
      label: "当前综合周榜",
      url: "https://www.joysound.com/web/karaoke/ranking/all/weekly",
      parser: "ranking",
      category: "pop",
      year: CURRENT_RANKING_YEAR,
      yearKind: "ranking",
    },
    {
      id: "priority-current-general-monthly",
      label: "当前综合月榜",
      url: "https://www.joysound.com/web/karaoke/ranking/all/monthly",
      parser: "ranking",
      category: "pop",
      year: CURRENT_RANKING_YEAR,
      yearKind: "ranking",
    },
    {
      id: "priority-current-hot",
      label: "当前急上升榜",
      url: "https://www.joysound.com/web/karaoke/ranking/hot",
      parser: "ranking",
      category: "pop",
      year: CURRENT_RANKING_YEAR,
      yearKind: "ranking",
    },
    {
      id: "priority-current-trends",
      label: "当前新曲趋势榜",
      url: "https://www.joysound.com/web/karaoke/ranking/trends/all",
      parser: "ranking",
      category: "pop",
      year: CURRENT_RANKING_YEAR,
      yearKind: "ranking",
    },
    {
      id: "priority-current-access",
      label: "当前页面访问榜",
      url: "https://www.joysound.com/web/karaoke/ranking/pv",
      parser: "ranking",
      category: "pop",
      year: CURRENT_RANKING_YEAR,
      yearKind: "ranking",
    },
    {
      id: "priority-half-year-2026",
      label: "2026 上半年榜",
      url: "https://www.joysound.com/web/s/karaoke/feature/ranking/2026-half",
      parser: "annual",
      year: 2026,
      yearKind: "ranking",
    },
  ];

  const annualStartYear = Math.max(2000, minimumYear ?? 2012);
  for (let year = 2025; year >= annualStartYear; year -= 1) {
    sources.push({
      id: `priority-annual-${year}`,
      label: `${year} 年度榜（综合、ACG、流行分类）`,
      url:
        `https://www.joysound.com/web/s/karaoke/contents/annual_ranking/${year}`,
      parser: "annual",
      year,
      yearKind: "ranking",
    });
  }

  const releasedStartYear = Math.max(2000, minimumYear ?? 2016);
  for (let year = 2025; year >= releasedStartYear; year -= 1) {
    sources.push({
      id: `priority-released-${year}`,
      label: `${year} 年发行歌曲榜`,
      url:
        `https://www.joysound.com/web/s/karaoke/contents/annual_ranking/${year}-02`,
      parser: "released",
      year,
      yearKind: "release",
    });
  }

  const ageStartYear = Math.max(2000, minimumYear ?? 2014);
  for (let year = 2025; year >= ageStartYear; year -= 1) {
    sources.push({
      id: `priority-age-${year}`,
      label: `${year} 年 10～40 岁榜`,
      url: `https://www.joysound.com/web/s/karaoke/feature/annual_age_${year}`,
      parser: "age",
      category: "pop",
      year,
      yearKind: "ranking",
    });
  }

  return sources;
}

function createArtistSeeds(parsedSources: ParsedSource[]): Map<string, ArtistSeed> {
  const seeds = new Map<string, ArtistSeed>();

  for (const parsed of parsedSources) {
    if (parsed.source.parser === "exclude") {
      continue;
    }

    for (const artistUrl of parsed.artistUrls) {
      const artistId = artistUrl.split("/").at(-1);
      if (!artistId) {
        continue;
      }

      const category = parsed.source.category ?? "pop";
      const current = seeds.get(artistUrl) ?? {
        url: artistUrl,
        artistId,
        priority: sourcePriority(parsed.source, 1),
        categories: new Set<Category>(),
        sourceIds: new Set<string>(),
        year: parsed.source.year,
        yearKind: parsed.source.yearKind,
      };
      current.priority = Math.min(
        current.priority,
        sourcePriority(parsed.source, 1),
      );
      current.categories.add(category);
      current.sourceIds.add(parsed.source.id);
      seeds.set(artistUrl, current);
    }
  }

  return seeds;
}

function addExistingArtistCandidates(
  candidates: Candidate[],
  fullArtistIndex: FullArtistCandidateIndex,
  artistSeeds: Map<string, ArtistSeed>,
  artistLimit: number,
) {
  const artistById = new Map(
    [...artistSeeds.values()].map((artist) => [artist.artistId, artist]),
  );

  for (const entry of fullArtistIndex.entries) {
    for (const source of entry.sources) {
      if (source.rank === undefined || source.rank > artistLimit) {
        continue;
      }

      const artist = artistById.get(source.artistId);
      if (!artist) {
        continue;
      }

      candidates.push({
        url: entry.url,
        category: artist.categories.has("acg") ? "acg" : "pop",
        priority: artist.priority + 100 + source.rank,
        sourceIds: [...artist.sourceIds],
      rank: source.rank,
      artistId: source.artistId,
      artistName: source.artistName,
      year: artist.year,
      yearKind: artist.yearKind,
      });
    }
  }
}

async function loadOrFetchSource(
  source: SeedSource,
  checkpoint: Checkpoint,
  requestState: { count: number; lastRequestAt: number },
  refresh: boolean,
  checkpointPath: string,
): Promise<ParsedSource> {
  const saved = checkpoint.items[source.id];
  if (
    !refresh &&
    saved &&
    "parser" in saved.source &&
    saved.source.url === source.url &&
    saved.source.parser === source.parser &&
    !(
      source.parser === "ranking" &&
      "artistUrls" in saved &&
      saved.artistUrls.length === 0
    )
  ) {
    console.log(`使用优先榜单检查点：${source.label}`);
    return saved as ParsedSource;
  }

  await waitForRequestSlot(requestState);
  console.log(`读取优先榜单入口：${source.label} ${source.url}`);
  requestState.count += 1;
  requestState.lastRequestAt = Date.now();

  let parsed: ParsedSource;
  try {
    const html = await fetchText(source.url, 3);
    parsed = parseSource(source, html);
  } catch (error) {
    if (error instanceof HttpStatusError && error.status === 404) {
      parsed = {
        source,
        status: "unavailable",
        fetchedAt: new Date().toISOString(),
        songCandidates: [],
        artistUrls: [],
        excludedArtistNames: [],
        error: error.message,
      };
    } else {
      throw error;
    }
  }

  checkpoint.items[source.id] = parsed;
  checkpoint.updatedAt = new Date().toISOString();
  await writeJsonAtomic(checkpointPath, checkpoint);
  return parsed;
}

function parseSource(source: SeedSource, html: string): ParsedSource {
  if (source.parser === "exclude") {
    return {
      source,
      status: "success",
      fetchedAt: new Date().toISOString(),
      songCandidates: [],
      artistUrls: [],
      excludedArtistNames: extractRankingArtistNames(html),
    };
  }

  if (source.parser === "ranking") {
    return {
      source,
      status: "success",
      fetchedAt: new Date().toISOString(),
      songCandidates: extractOrderedOfficialUrls(
        html,
        /^\/web\/search\/song\/\d+$/,
      ).map((url, index) => ({
        url,
        category: source.category ?? "pop",
        rank: index + 1,
        year: source.year,
        yearKind: source.yearKind,
      })),
      artistUrls: extractOrderedOfficialUrls(
        html,
        /^\/web\/search\/artist\/\d+$/,
      ),
      excludedArtistNames: [],
    };
  }

  if (source.parser === "age") {
    return {
      source,
      status: "success",
      fetchedAt: new Date().toISOString(),
      songCandidates: extractAge10To40SongUrls(html).map((url, index) => ({
        url,
        category: source.category ?? "pop",
        rank: index + 1,
        year: source.year,
        yearKind: source.yearKind,
      })),
      artistUrls: [],
      excludedArtistNames: [],
    };
  }

  const $ = load(html);
  const songCandidates: ParsedSource["songCandidates"] = [];
  const rules: Array<{ match: RegExp; category: Category }> = [
    { match: /カラオケ総合ランキング/, category: "pop" },
    { match: /アニメ.*(?:ゲーム|特撮)?ランキング/, category: "acg" },
    { match: /(?:VOCALOID|ボカロ).*ランキング/, category: "acg" },
    { match: /東方系ランキング/, category: "acg" },
    {
      match: /(?:ボーイズグループ|ガールズグループ|ネット発アーティスト楽曲|サビカラ).*ランキング/,
      category: "pop",
    },
  ];

  for (const rule of rules) {
    let rank = 0;
    $("h2").each((_, heading) => {
      const title = $(heading).text().replace(/\s+/g, " ").trim();
      if (!rule.match.test(title)) {
        return;
      }

      let sibling = $(heading).next();
      while (sibling.length > 0 && sibling[0]?.tagName !== "h2") {
        sibling.find("a[href*='/web/search/song/']").each(
          (_, element) => {
            const href = $(element).attr("href") ?? "";
            const match = href.match(/^\/web\/search\/song\/\d+$/);
            if (match) {
              rank += 1;
              songCandidates.push({
                url: `https://www.joysound.com${match[0]}`,
                category: rule.category,
                rank,
                year: source.year,
                yearKind: source.yearKind,
              });
            }
          },
        );
        sibling = sibling.next();
      }
    });
  }

  return {
    source,
    status: "success",
    fetchedAt: new Date().toISOString(),
    songCandidates,
    artistUrls: extractSectionUrls(
      $,
      /^アーティストランキング$/,
      /^\/web\/search\/artist\/\d+$/,
    ),
    excludedArtistNames: [],
  };
}

async function loadOrFetchArtistPage(
  artist: ArtistSeed,
  page: number,
  limit: number,
  checkpoint: Checkpoint,
  requestState: { count: number; lastRequestAt: number },
  refresh: boolean,
  checkpointPath: string,
): Promise<ParsedArtistPage> {
  const source = {
    id: `priority-artist-${artist.artistId}-page-${page}`,
    url: `${artist.url}?sort=popular&page=${page}`,
    artistId: artist.artistId,
    page,
    limit,
  };
  const saved = checkpoint.items[source.id];
  if (
    !refresh &&
    saved &&
    "artistId" in saved.source &&
    saved.source.artistId === source.artistId &&
    saved.source.page === source.page &&
    saved.source.url === source.url
  ) {
    console.log(`使用优先歌手检查点：${source.id}`);
    return saved as ParsedArtistPage;
  }

  await waitForRequestSlot(requestState);
  console.log(`读取优先歌手页面：${source.url}`);
  requestState.count += 1;
  requestState.lastRequestAt = Date.now();

  let parsed: ParsedArtistPage;
  try {
    const html = await fetchText(source.url, 3);
    const pageResult = extractArtistCatalogPage(html);
    const artistName = extractArtistName(html);
    parsed = {
      source,
      status: "success",
      fetchedAt: new Date().toISOString(),
      artistName,
      totalCount: pageResult.totalCount,
      songCandidates: pageResult.songUrls
        .slice(0, limit - (page - 1) * ARTIST_PAGE_SIZE)
        .map((url, index) => ({
          url,
          rank: pageResult.startIndex + index,
        })),
    };
  } catch (error) {
    if (error instanceof HttpStatusError && error.status === 404) {
      parsed = {
        source,
        status: "unavailable",
        fetchedAt: new Date().toISOString(),
        songCandidates: [],
        error: error.message,
      };
    } else {
      throw error;
    }
  }

  checkpoint.items[source.id] = parsed;
  checkpoint.updatedAt = new Date().toISOString();
  await writeJsonAtomic(checkpointPath, checkpoint);
  return parsed;
}

function addArtistPageCandidates(
  candidates: Candidate[],
  parsed: ParsedArtistPage,
  artist: ArtistSeed,
) {
  for (const song of parsed.songCandidates) {
    candidates.push({
      url: song.url,
      category: artist.categories.has("acg") ? "acg" : "pop",
      priority: artist.priority + 100 + song.rank,
      sourceIds: [...artist.sourceIds],
      rank: song.rank,
      artistId: artist.artistId,
      artistName: parsed.artistName,
      year: artist.year,
      yearKind: artist.yearKind,
    });
  }
}

function mergeAndSelectCandidates(
  candidates: Candidate[],
  productionUrls: Set<string>,
  excludedUrls: Set<string>,
  targetPages: number,
  newOnly: boolean,
  minimumYear: number | undefined,
) {
  const byUrl = new Map<string, Candidate>();
  for (const candidate of candidates) {
    const existing = byUrl.get(candidate.url);
    if (!existing) {
      byUrl.set(candidate.url, candidate);
      continue;
    }

    const previousPriority = existing.priority;
    existing.priority = Math.min(existing.priority, candidate.priority);
    existing.category =
      existing.category === "acg" || candidate.category === "acg"
        ? "acg"
        : "pop";
    existing.sourceIds = [
      ...new Set([...existing.sourceIds, ...candidate.sourceIds]),
    ];
    if (
      candidate.priority < previousPriority ||
      (existing.rank === undefined && candidate.rank !== undefined)
    ) {
      existing.rank = candidate.rank;
      existing.year = candidate.year;
      existing.yearKind = candidate.yearKind;
      existing.artistId = candidate.artistId;
      existing.artistName = candidate.artistName;
    }
  }

  const filteredCandidates = filterByMinimumYear(
    [...byUrl.values()]
      .sort(
        (first, second) =>
          first.priority - second.priority ||
          first.category.localeCompare(second.category) ||
          first.url.localeCompare(second.url),
      )
      .filter(
        (candidate) =>
          !excludedUrls.has(candidate.url) &&
          (!newOnly || !productionUrls.has(candidate.url)),
      ),
    minimumYear,
  );

  return filteredCandidates
    .slice(0, targetPages)
    .map((candidate) => ({
      ...candidate,
      alreadyInProductionCatalog: productionUrls.has(candidate.url),
    }));
}

function createOutput(
  entries: Array<Candidate & { alreadyInProductionCatalog: boolean }>,
  parsedSources: ParsedSource[],
  artistSeeds: Map<string, ArtistSeed>,
  options: CliOptions,
) {
  const sourceCounts = Object.fromEntries(
    parsedSources.map((source) => [
      source.source.id,
      source.songCandidates.length,
    ]),
  );
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    policy: {
      targetPages: options.targetPages,
      artistLimit: options.artistLimit,
      selection: options.newOnly
        ? "排除生产曲库与上一批候选后按优先级取前 N 页"
        : options.excludeIndexPaths.length > 0
          ? "排除上一批候选后按优先级取前 N 页"
          : "按优先级取前 N 页",
      excludeIndexPaths: options.excludeIndexPaths,
      minimumYear: options.minimumYear ?? null,
      yearSemantics:
        "year 是候选来源的榜单年份；released 来源使用发行榜年份，严格模式排除低于下限或缺少年份的候选",
      priorityOrder:
        "当前 ACG 榜单 → 当前流行榜单 → 年度 ACG/流行榜单 → 发行榜 → 年龄榜 → 歌手热门前 N 首",
      requiredCategories: ["acg", "pop"],
      excludedCategories: ["演歌／歌謡曲", "洋楽", "K-POP／韓国曲"],
    },
    summary: {
      requestedSourcePages: parsedSources.length,
      successfulSourcePages: parsedSources.filter(
        (source) => source.status === "success",
      ).length,
      unavailableSourcePages: parsedSources.filter(
        (source) => source.status === "unavailable",
      ).length,
      artistSeeds: artistSeeds.size,
      uniqueSongPages: entries.length,
      alreadyInProductionCatalogPages: entries.filter(
        (entry) => entry.alreadyInProductionCatalog,
      ).length,
      newForProductionPages: entries.filter(
        (entry) => !entry.alreadyInProductionCatalog,
      ).length,
      acgPages: entries.filter((entry) => entry.category === "acg").length,
      popPages: entries.filter((entry) => entry.category === "pop").length,
      sourceCounts,
    },
    sources: parsedSources.map((source) => ({
      id: source.source.id,
      label: source.source.label,
      url: source.source.url,
      parser: source.source.parser,
      status: source.status,
      candidateCount: source.songCandidates.length,
      artistCount: source.artistUrls.length,
      ...(source.error ? { error: source.error } : {}),
    })),
    entries,
  };
}

function sourcePriority(
  source: SeedSource,
  rank: number,
  year?: number,
  category = source.category,
) {
  if (source.parser === "ranking") {
    const acgOffset = category === "acg" ? 0 : 100;
    return acgOffset + rank;
  }

  const yearOffset = 1_000 + (2026 - (year ?? source.year ?? 2012)) * 20;
  return yearOffset + (category === "acg" ? 0 : 100) + rank;
}

function compareArtistSeeds(first: ArtistSeed, second: ArtistSeed) {
  return (
    first.priority - second.priority ||
    first.artistId.localeCompare(second.artistId)
  );
}

function extractOrderedOfficialUrls(html: string, pathPattern: RegExp) {
  const seen = new Set<string>();
  const urls: string[] = [];
  const unanchoredPattern = pathPattern.source
    .replace(/^\^/, "")
    .replace(/\$$/, "");
  const pathPatternWithGlobal = new RegExp(unanchoredPattern, "g");

  for (const match of html.matchAll(pathPatternWithGlobal)) {
    const path = match[0];
    if (seen.has(path)) {
      continue;
    }
    seen.add(path);
    urls.push(`https://www.joysound.com${path}`);
  }

  return urls;
}

function extractSectionUrls(
  $: ReturnType<typeof load>,
  headingPattern: RegExp,
  pathPattern: RegExp,
) {
  const seen = new Set<string>();
  const urls: string[] = [];

  $("h2").each((_, heading) => {
    const title = $(heading).text().replace(/\s+/g, " ").trim();
    if (!headingPattern.test(title)) {
      return;
    }

    let sibling = $(heading).next();
    while (sibling.length > 0 && sibling[0]?.tagName !== "h2") {
      sibling.find("a[href]").each((__, element) => {
        const href = ($(element).attr("href") ?? "").split(/[?#]/, 1)[0] ?? "";
        if (!pathPattern.test(href) || seen.has(href)) {
          return;
        }
        seen.add(href);
        urls.push(`https://www.joysound.com${href}`);
      });
      sibling = sibling.next();
    }
  });

  return urls;
}

function extractArtistName(html: string): string {
  const match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  return (match?.[1] ?? "")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

async function loadCheckpoint(checkpointPath: string): Promise<Checkpoint> {
  try {
    const parsed = await readJson<Checkpoint>(checkpointPath);
    if (parsed.schemaVersion === 1 && parsed.items) {
      return parsed;
    }
  } catch {
    // 第一次运行时从空检查点开始。
  }

  return {
    schemaVersion: 1,
    updatedAt: new Date().toISOString(),
    items: {},
  };
}

async function readExcludedUrls(
  excludeIndexPaths: string[],
): Promise<Set<string>> {
  const excludedUrls = new Set<string>();

  for (const excludeIndexPath of excludeIndexPaths) {
    const index = await readJson<{ entries: Array<{ url: string }> }>(
      excludeIndexPath,
    );
    for (const entry of index.entries) {
      excludedUrls.add(entry.url);
    }
  }

  return excludedUrls;
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T;
}

async function writeJsonAtomic(path: string, value: unknown) {
  const absolutePath = resolve(path);
  const temporaryPath = `${absolutePath}.tmp`;
  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporaryPath, absolutePath);
}

async function waitForRequestSlot(requestState: {
  count: number;
  lastRequestAt: number;
}) {
  if (requestState.count > 0 && requestState.count % BATCH_SIZE === 0) {
    const batchPauseMs = randomIntegerInclusive(
      MINIMUM_BATCH_PAUSE_MS,
      MAXIMUM_BATCH_PAUSE_MS,
    );
    console.log(
      `已完成 ${requestState.count} 个真实请求，随机冷却 ${batchPauseMs}ms`,
    );
    await sleep(batchPauseMs);
    requestState.lastRequestAt = 0;
  }

  if (requestState.lastRequestAt === 0) {
    return;
  }

  const delay = DELAY_MS + randomIntegerInclusive(0, JITTER_MS);
  const remaining = delay - (Date.now() - requestState.lastRequestAt);
  if (remaining > 0) {
    await sleep(remaining);
  }
}

async function fetchText(url: string, retries: number): Promise<string> {
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const response = await fetch(url, {
      headers: {
        Accept: "text/html,*/*;q=0.8",
        "Accept-Language": "ja,en;q=0.8",
        "User-Agent":
          "joysound-helper/0.3 (authorized priority ranking discovery; rate limited)",
      },
      signal: AbortSignal.timeout(30_000),
    });

    if (response.ok) {
      return response.text();
    }

    const error = new HttpStatusError(
      response.status,
      `${url} 返回 HTTP ${response.status}`,
    );
    if (response.status === 403 || attempt === retries) {
      throw error;
    }
    if (response.status === 429) {
      const retryAfter = response.headers.get("retry-after");
      const retryAfterMs = retryAfter
        ? Math.max(0, Number(retryAfter) * 1_000)
        : 60_000 * 2 ** attempt;
      console.warn(`${error.message}，${retryAfterMs}ms 后重试`);
      await sleep(retryAfterMs);
      continue;
    }
    if (response.status >= 500) {
      const retryDelayMs = 5_000 * 2 ** attempt;
      console.warn(`${error.message}，${retryDelayMs}ms 后重试`);
      await sleep(retryDelayMs);
      continue;
    }
    throw error;
  }

  throw new Error(`${url} 重试后仍然失败`);
}

function parseOptions(args: string[]): CliOptions {
  const options: CliOptions = {
    targetPages: DEFAULT_TARGET_PAGES,
    artistLimit: DEFAULT_ARTIST_LIMIT,
    outputPath: OUTPUT_PATH,
    checkpointPath: CHECKPOINT_PATH,
    excludeIndexPaths: [],
    newOnly: false,
    refresh: false,
    confirmAuthorizedDiscovery: false,
    help: false,
  };

  for (const argument of args) {
    if (argument === "--refresh") {
      options.refresh = true;
    } else if (argument === "--confirm-authorized-discovery") {
      options.confirmAuthorizedDiscovery = true;
    } else if (argument === "--new-only") {
      options.newOnly = true;
    } else if (argument.startsWith("--target=")) {
      options.targetPages = parsePositiveInteger(
        "target",
        argument.slice("--target=".length),
      );
    } else if (argument.startsWith("--artist-limit=")) {
      options.artistLimit = parsePositiveInteger(
        "artist-limit",
        argument.slice("--artist-limit=".length),
      );
    } else if (argument.startsWith("--output=")) {
      options.outputPath = argument.slice("--output=".length);
    } else if (argument.startsWith("--checkpoint=")) {
      options.checkpointPath = argument.slice("--checkpoint=".length);
    } else if (argument.startsWith("--exclude-index=")) {
      options.excludeIndexPaths.push(
        argument.slice("--exclude-index=".length),
      );
    } else if (argument.startsWith("--min-year=")) {
      options.minimumYear = parsePositiveInteger(
        "min-year",
        argument.slice("--min-year=".length),
      );
    } else if (argument === "--help" || argument === "-h") {
      options.help = true;
    } else {
      throw new Error(`未知参数：${argument}`);
    }
  }

  return options;
}

function parsePositiveInteger(name: string, value: string) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} 必须是正整数`);
  }
  return parsed;
}

function printSummary(
  output: ReturnType<typeof createOutput>,
  outputPath: string,
) {
  console.log(`优先榜单候选索引：${resolve(outputPath)}`);
  console.log(
    `入口页面：成功 ${output.summary.successfulSourcePages}/` +
      `${output.summary.requestedSourcePages}，不可用 ${output.summary.unavailableSourcePages}`,
  );
  console.log(
    `歌曲页面：${output.summary.uniqueSongPages}，` +
      `ACG ${output.summary.acgPages}，流行 ${output.summary.popPages}，` +
      `待新增 ${output.summary.newForProductionPages}`,
  );
  console.log(`歌手入口：${output.summary.artistSeeds}`);
}

function printHelp() {
  console.log(`按当前与年度热门榜单生成优先候选索引

用法：
  bun run discover:priority -- --confirm-authorized-discovery

参数：
  --confirm-authorized-discovery  确认允许低速读取官方榜单和歌手页
  --target=N                     目标候选页面数，默认 10000
  --artist-limit=N               每位歌手取热门前 N 首，默认 100
  --output=PATH                  候选索引输出路径
  --checkpoint=PATH              发现检查点路径
  --exclude-index=PATH           可重复，排除已有批次候选索引中的歌曲页面
  --min-year=YYYY                严格保留来源年份不早于 YYYY 的候选
  --new-only                     同时排除当前生产曲库中的歌曲页面
  --refresh                      忽略本任务检查点重新读取
  --help                         显示帮助
`);
}

function randomIntegerInclusive(minimum: number, maximum: number) {
  return minimum + Math.floor(Math.random() * (maximum - minimum + 1));
}

function sleep(milliseconds: number) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
