import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import {
  extractAge10To40SongUrls,
  extractAllSongUrls,
  extractAnnualSongUrls,
  extractArtistPopularSongUrls,
  extractArtistUrls,
  type RankingSection,
} from "./lib/joysound-ranking";

const OUTPUT_PATH =
  "src/data/generated/joysound-ranked-candidates.json";
const CHECKPOINT_PATH =
  ".cache/joysound-ranking-discovery/checkpoint.json";
const POPULAR_INDEX_PATH =
  "src/data/generated/joysound-popular-index.json";
const PRODUCTION_CATALOG_PATH =
  "src/data/generated/joysound-popular-catalog.json";
const DELAY_MS = 5_000;
const JITTER_MS = 2_000;
const BATCH_SIZE = 50;
const MINIMUM_BATCH_PAUSE_MS = 45_000;
const MAXIMUM_BATCH_PAUSE_MS = 60_000;

type ParserType =
  | "all-songs"
  | "annual"
  | "released"
  | "age"
  | "artists"
  | "artist-popular";

type RankingSource = {
  id: string;
  label: string;
  url: string;
  parser: ParserType;
  section?: RankingSection;
};

type CandidateSource = {
  sourceId: string;
  sections: RankingSection[];
};

type ParsedSource = {
  source: RankingSource;
  status: "success" | "unavailable";
  fetchedAt: string;
  candidates: Array<{
    url: string;
    sections: RankingSection[];
  }>;
  artistUrls: string[];
  error?: string;
};

type Checkpoint = {
  schemaVersion: 1;
  updatedAt: string;
  items: Record<string, ParsedSource>;
};

type PopularIndex = {
  entries: Array<{ url: string }>;
};

type ProductionCatalog = {
  songs: Array<{ sourceUrl: string }>;
};

type CliOptions = {
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
      "榜单发现会低速读取多个官方入口；确认授权后请添加 --confirm-authorized-discovery",
    );
  }

  const checkpoint = await loadCheckpoint();
  const requestState = { count: 0, lastRequestAt: 0 };
  const parsedSources: ParsedSource[] = [];
  const artistUrls = new Set<string>();

  for (const source of createSeedSources()) {
    const parsed = await loadOrFetchSource(
      source,
      checkpoint,
      requestState,
      options.refresh,
    );
    parsedSources.push(parsed);

    for (const artistUrl of parsed.artistUrls) {
      artistUrls.add(artistUrl);
    }
  }

  console.log(`热门歌手去重后共 ${artistUrls.size} 页`);

  for (const [index, artistUrl] of [...artistUrls].sort().entries()) {
    const artistId = artistUrl.split("/").at(-1);
    const source: RankingSource = {
      id: `popular-artist-${artistId}`,
      label: `热门歌手 ${index + 1}/${artistUrls.size}`,
      url: artistUrl,
      parser: "artist-popular",
      section: "popular-artist",
    };
    parsedSources.push(
      await loadOrFetchSource(
        source,
        checkpoint,
        requestState,
        options.refresh,
      ),
    );
  }

  const output = await createOutput(parsedSources);
  await writeJsonAtomic(OUTPUT_PATH, output);
  printSummary(output);
}

function createSeedSources(): RankingSource[] {
  const sources: RankingSource[] = [
    createSource(
      "current-general-daily",
      "当前综合日榜 TOP100",
      "/web/karaoke/ranking/all",
      "all-songs",
      "general",
    ),
    createSource(
      "current-general-weekly",
      "当前综合周榜 TOP100",
      "/web/karaoke/ranking/all/weekly",
      "all-songs",
      "general",
    ),
    createSource(
      "current-general-monthly",
      "当前综合月榜 TOP100",
      "/web/karaoke/ranking/all/monthly",
      "all-songs",
      "general",
    ),
    createSource(
      "current-anime-weekly",
      "当前动漫周榜 TOP100",
      "/web/karaoke/ranking/anime/weekly",
      "all-songs",
      "anime",
    ),
    createSource(
      "current-anime-monthly",
      "当前动漫月榜 TOP100",
      "/web/karaoke/ranking/anime/monthly",
      "all-songs",
      "anime",
    ),
    createSource(
      "current-vocaloid-weekly",
      "当前 Vocaloid 周榜 TOP100",
      "/web/karaoke/ranking/vocaloid/weekly",
      "all-songs",
      "vocaloid",
    ),
    createSource(
      "current-vocaloid-monthly",
      "当前 Vocaloid 月榜 TOP100",
      "/web/karaoke/ranking/vocaloid/monthly",
      "all-songs",
      "vocaloid",
    ),
    createSource(
      "current-hot",
      "当前急上升榜",
      "/web/karaoke/ranking/hot",
      "all-songs",
      "general",
    ),
    createSource(
      "current-trends",
      "当前新曲趋势榜",
      "/web/karaoke/ranking/trends/all",
      "all-songs",
      "general",
    ),
    createSource(
      "current-access",
      "当前页面访问榜",
      "/web/karaoke/ranking/pv",
      "all-songs",
      "general",
    ),
    createSource(
      "current-artists-weekly",
      "当前歌手周榜",
      "/web/karaoke/ranking/artist/weekly",
      "artists",
    ),
    createSource(
      "current-artists-monthly",
      "当前歌手月榜",
      "/web/karaoke/ranking/artist/monthly",
      "artists",
    ),
    createSource(
      "half-year-2026",
      "2026 上半年榜",
      "/web/s/karaoke/feature/ranking/2026-half",
      "annual",
    ),
  ];

  for (let year = 2012; year <= 2025; year += 1) {
    sources.push(
      createSource(
        `annual-${year}`,
        `${year} 年度综合、动漫与 Vocaloid 榜`,
        `/web/s/karaoke/contents/annual_ranking/${year}`,
        "annual",
      ),
    );
  }

  for (let year = 2016; year <= 2025; year += 1) {
    sources.push(
      createSource(
        `released-${year}`,
        `${year} 年发行歌曲榜`,
        `/web/s/karaoke/contents/annual_ranking/${year}-02`,
        "released",
      ),
    );
  }

  for (let year = 2014; year <= 2025; year += 1) {
    sources.push(
      createSource(
        `age-${year}`,
        `${year} 年 10～40 岁榜`,
        `/web/s/karaoke/feature/annual_age_${year}`,
        "age",
        "age-10-40",
      ),
    );
  }

  return sources;
}

function createSource(
  id: string,
  label: string,
  path: string,
  parser: ParserType,
  section?: RankingSection,
): RankingSource {
  return {
    id,
    label,
    url: `https://www.joysound.com${path}`,
    parser,
    ...(section ? { section } : {}),
  };
}

async function loadOrFetchSource(
  source: RankingSource,
  checkpoint: Checkpoint,
  requestState: { count: number; lastRequestAt: number },
  refresh: boolean,
): Promise<ParsedSource> {
  const saved = checkpoint.items[source.id];

  if (!refresh && saved?.source.url === source.url) {
    console.log(`使用榜单检查点：${source.label}`);
    return saved;
  }

  await waitForRequestSlot(requestState);
  console.log(`读取榜单：${source.label} ${source.url}`);
  requestState.count += 1;
  requestState.lastRequestAt = Date.now();

  let parsed: ParsedSource;

  try {
    const html = await fetchText(source.url);
    parsed = parseSource(source, html);
  } catch (error) {
    if (error instanceof HttpStatusError && error.status === 404) {
      parsed = {
        source,
        status: "unavailable",
        fetchedAt: new Date().toISOString(),
        candidates: [],
        artistUrls: [],
        error: error.message,
      };
    } else {
      throw error;
    }
  }

  checkpoint.items[source.id] = parsed;
  checkpoint.updatedAt = new Date().toISOString();
  await writeJsonAtomic(CHECKPOINT_PATH, checkpoint);
  return parsed;
}

function parseSource(
  source: RankingSource,
  html: string,
): ParsedSource {
  const candidates: ParsedSource["candidates"] = [];
  let artistUrls: string[] = [];

  if (source.parser === "all-songs") {
    addCandidates(candidates, extractAllSongUrls(html), [
      source.section ?? "general",
    ]);
  } else if (
    source.parser === "annual" ||
    source.parser === "released"
  ) {
    const sections = extractAnnualSongUrls(html);
    const releasedSection =
      source.parser === "released" ? ["released" as const] : [];

    addCandidates(candidates, sections.general, [
      ...releasedSection,
      "general",
    ]);
    addCandidates(candidates, sections.anime, [
      ...releasedSection,
      "anime",
    ]);
    addCandidates(candidates, sections.vocaloid, [
      ...releasedSection,
      "vocaloid",
    ]);
  } else if (source.parser === "age") {
    addCandidates(candidates, extractAge10To40SongUrls(html), [
      "age-10-40",
    ]);
  } else if (source.parser === "artists") {
    artistUrls = extractArtistUrls(html);
  } else if (source.parser === "artist-popular") {
    addCandidates(
      candidates,
      extractArtistPopularSongUrls(html),
      ["popular-artist"],
    );
  }

  return {
    source,
    status: "success",
    fetchedAt: new Date().toISOString(),
    candidates,
    artistUrls,
  };
}

function addCandidates(
  target: ParsedSource["candidates"],
  urls: string[],
  sections: RankingSection[],
) {
  for (const url of urls) {
    target.push({ url, sections });
  }
}

async function waitForRequestSlot(requestState: {
  count: number;
  lastRequestAt: number;
}) {
  if (
    requestState.count > 0 &&
    requestState.count % BATCH_SIZE === 0
  ) {
    const batchPauseMs =
      MINIMUM_BATCH_PAUSE_MS +
      Math.floor(
        Math.random() *
          (MAXIMUM_BATCH_PAUSE_MS - MINIMUM_BATCH_PAUSE_MS + 1),
      );
    console.log(
      `已完成 ${requestState.count} 个榜单请求，` +
        `随机冷却 ${batchPauseMs}ms`,
    );
    await sleep(batchPauseMs);
    requestState.lastRequestAt = 0;
  }

  if (requestState.lastRequestAt === 0) {
    return;
  }

  const delay =
    DELAY_MS + Math.floor(Math.random() * (JITTER_MS + 1));
  const remaining = delay - (Date.now() - requestState.lastRequestAt);

  if (remaining > 0) {
    await sleep(remaining);
  }
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: {
      Accept: "text/html,*/*;q=0.8",
      "Accept-Language": "ja,en;q=0.8",
      "User-Agent":
        "joysound-helper/0.3 (authorized ranking discovery; rate limited)",
    },
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    throw new HttpStatusError(
      response.status,
      `${url} 返回 HTTP ${response.status}`,
    );
  }

  return response.text();
}

async function createOutput(parsedSources: ParsedSource[]) {
  const candidateMap = new Map<string, Map<string, CandidateSource>>();

  for (const parsed of parsedSources) {
    for (const candidate of parsed.candidates) {
      const sources =
        candidateMap.get(candidate.url) ??
        new Map<string, CandidateSource>();
      sources.set(parsed.source.id, {
        sourceId: parsed.source.id,
        sections: candidate.sections,
      });
      candidateMap.set(candidate.url, sources);
    }
  }

  const popularIndex = await readPopularIndex();
  const productionCatalog = await readProductionCatalog();
  const knownUrls = new Set(
    popularIndex?.entries.map((entry) => entry.url) ?? [],
  );
  const productionUrls = new Set(
    productionCatalog?.songs.map((song) => song.sourceUrl) ?? [],
  );
  const entries = [...candidateMap.entries()]
    .map(([url, sources]) => ({
      url,
      alreadyInPopularIndex: knownUrls.has(url),
      alreadyInProductionCatalog: productionUrls.has(url),
      sources: [...sources.values()].sort((first, second) =>
        first.sourceId.localeCompare(second.sourceId),
      ),
    }))
    .sort((first, second) => first.url.localeCompare(second.url));
  const sectionCounts = Object.fromEntries(
    (
      [
        "general",
        "anime",
        "vocaloid",
        "released",
        "age-10-40",
        "popular-artist",
      ] satisfies RankingSection[]
    ).map((section) => [
      section,
      entries.filter((entry) =>
        entry.sources.some((source) =>
          source.sections.includes(section),
        ),
      ).length,
    ]),
  );

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    policy: {
      annualYears: "2012-2025",
      releasedYears: "2016-2025",
      ageRankingYears: "2014-2025",
      ageGroups: "10-40",
      requiredCategories: ["general", "anime", "vocaloid"],
      artistRule: "当前周榜或月榜歌手的官方热门歌曲",
      excludedCategories: [
        "演歌／歌謡曲",
        "洋楽",
        "K-POP／韓国曲",
      ],
    },
    summary: {
      requestedSourcePages: parsedSources.length,
      successfulSourcePages: parsedSources.filter(
        (source) => source.status === "success",
      ).length,
      unavailableSourcePages: parsedSources.filter(
        (source) => source.status === "unavailable",
      ).length,
      uniqueSongPages: entries.length,
      alreadyInPopularIndexPages: entries.filter(
        (entry) => entry.alreadyInPopularIndex,
      ).length,
      newSongPages: entries.filter(
        (entry) => !entry.alreadyInPopularIndex,
      ).length,
      alreadyInProductionCatalogPages: entries.filter(
        (entry) => entry.alreadyInProductionCatalog,
      ).length,
      newForProductionPages: entries.filter(
        (entry) => !entry.alreadyInProductionCatalog,
      ).length,
      sectionCounts,
    },
    sources: parsedSources.map((parsed) => ({
      id: parsed.source.id,
      label: parsed.source.label,
      url: parsed.source.url,
      status: parsed.status,
      candidateCount: parsed.candidates.length,
      artistCount: parsed.artistUrls.length,
      ...(parsed.error ? { error: parsed.error } : {}),
    })),
    entries,
  };
}

async function readPopularIndex(): Promise<PopularIndex | undefined> {
  try {
    return JSON.parse(
      await readFile(POPULAR_INDEX_PATH, "utf8"),
    ) as PopularIndex;
  } catch {
    return undefined;
  }
}

async function readProductionCatalog(): Promise<
  ProductionCatalog | undefined
> {
  try {
    return JSON.parse(
      await readFile(PRODUCTION_CATALOG_PATH, "utf8"),
    ) as ProductionCatalog;
  } catch {
    return undefined;
  }
}

async function loadCheckpoint(): Promise<Checkpoint> {
  try {
    const parsed = JSON.parse(
      await readFile(CHECKPOINT_PATH, "utf8"),
    ) as Checkpoint;

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

function parseOptions(args: string[]): CliOptions {
  const options: CliOptions = {
    refresh: false,
    confirmAuthorizedDiscovery: false,
    help: false,
  };

  for (const argument of args) {
    if (argument === "--refresh") {
      options.refresh = true;
    } else if (argument === "--confirm-authorized-discovery") {
      options.confirmAuthorizedDiscovery = true;
    } else if (argument === "--help" || argument === "-h") {
      options.help = true;
    } else {
      throw new Error(`未知参数：${argument}`);
    }
  }

  return options;
}

function printSummary(output: Awaited<ReturnType<typeof createOutput>>) {
  const { summary } = output;

  console.log(`候选索引：${resolve(OUTPUT_PATH)}`);
  console.log(
    `入口页面：成功 ${summary.successfulSourcePages}/` +
      `${summary.requestedSourcePages}，不可用 ${summary.unavailableSourcePages}`,
  );
  console.log(
    `唯一歌曲页面：${summary.uniqueSongPages}；` +
      `生产曲库已有 ${summary.alreadyInProductionCatalogPages}，` +
      `待新增 ${summary.newForProductionPages}`,
  );
  console.log(`分类去重计数：${JSON.stringify(summary.sectionCounts)}`);
}

async function writeJsonAtomic(path: string, value: unknown) {
  const absolutePath = resolve(path);
  const temporaryPath = `${absolutePath}.tmp`;

  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(
    temporaryPath,
    `${JSON.stringify(value, null, 2)}\n`,
    "utf8",
  );
  await rename(temporaryPath, absolutePath);
}

function sleep(milliseconds: number) {
  return new Promise((resolvePromise) =>
    setTimeout(resolvePromise, milliseconds),
  );
}

function printHelp() {
  console.log(`JOYSOUND 榜单候选发现

用法：
  bun run discover:joysound -- --confirm-authorized-discovery

参数：
  --confirm-authorized-discovery  确认允许低速读取官方榜单入口
  --refresh                       忽略榜单检查点并重新读取
  --help                          显示帮助
`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
