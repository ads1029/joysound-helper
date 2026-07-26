import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import {
  extractArtistCatalogPage,
  extractHeiseiYearSongUrls,
  extractRankingArtistNames,
} from "./lib/joysound-ranking";

const INPUT_INDEX_PATH =
  "src/data/generated/joysound-ranked-candidates.json";
const PRODUCTION_CATALOG_PATH =
  "src/data/generated/joysound-ranked-catalog.json";
const OUTPUT_PATH =
  "src/data/generated/joysound-expanded-candidates.json";
const CHECKPOINT_PATH =
  ".cache/joysound-expanded-discovery/checkpoint.json";
const ARTIST_LIMIT = 30;
const ARTIST_PAGE_SIZE = 20;
const DELAY_MS = 5_000;
const JITTER_MS = 2_000;
const BATCH_SIZE = 50;
const MINIMUM_BATCH_PAUSE_MS = 45_000;
const MAXIMUM_BATCH_PAUSE_MS = 60_000;

type ExpansionSection =
  | "popular-artist-expanded"
  | "heisei-1996-2011";

type PriorCandidateIndex = {
  schemaVersion: number;
  sources: Array<{
    id: string;
    url: string;
    status: "success" | "unavailable";
  }>;
};

type ProductionCatalog = {
  songs: Array<{ sourceUrl: string }>;
};

type ExpansionSource =
  | {
      id: string;
      label: string;
      url: string;
      parser: "artist-catalog";
      artistId: string;
      page: number;
      limit: number;
    }
  | {
      id: string;
      label: string;
      url: string;
      parser: "heisei";
      years: number[];
    }
  | {
      id: string;
      label: string;
      url: string;
      parser: "excluded-artists";
      category: "enka" | "foreign";
    };

type ParsedCandidate = {
  url: string;
  sections: ExpansionSection[];
  rank?: number;
  years?: number[];
};

type ParsedSource = {
  source: ExpansionSource;
  status: "success" | "unavailable";
  fetchedAt: string;
  candidates: ParsedCandidate[];
  excludedArtistNames: string[];
  excludedByCategory?: boolean;
  artistName?: string;
  totalCount?: number;
  error?: string;
};

type Checkpoint = {
  schemaVersion: 1;
  updatedAt: string;
  items: Record<string, ParsedSource>;
};

type CliOptions = {
  refresh: boolean;
  confirmAuthorizedDiscovery: boolean;
  help: boolean;
};

type CandidateSource = {
  sourceId: string;
  sections: ExpansionSection[];
  rank?: number;
  years?: number[];
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
      "扩展发现会低速读取多个官方入口；确认授权后请添加 --confirm-authorized-discovery",
    );
  }

  const priorIndex = await readJson<PriorCandidateIndex>(
    INPUT_INDEX_PATH,
  );
  const productionCatalog = await readJson<ProductionCatalog>(
    PRODUCTION_CATALOG_PATH,
  );
  validateInputs(priorIndex, productionCatalog);

  const checkpoint = await loadCheckpoint();
  const requestState = { count: 0, lastRequestAt: 0 };
  const parsedSources: ParsedSource[] = [];
  const excludedArtistNames = new Set<string>();

  for (const source of createExclusionSources()) {
    const parsed = await loadOrFetchSource(
      source,
      checkpoint,
      requestState,
      options.refresh,
    );
    parsedSources.push(parsed);

    for (const artistName of parsed.excludedArtistNames) {
      excludedArtistNames.add(artistName);
    }
  }

  const rankedArtistUrls = [
    ...new Set(
      priorIndex.sources
        .filter(
          (source) =>
            source.status === "success" &&
            source.id.startsWith("popular-artist-") &&
            /^https:\/\/www\.joysound\.com\/web\/search\/artist\/\d+$/.test(
              source.url,
            ),
        )
        .map((source) => source.url),
    ),
  ].sort();
  let excludedRankedArtistCount = 0;
  let selectedArtistCount = 0;

  for (const [index, artistUrl] of rankedArtistUrls.entries()) {
    const artistId = artistUrl.split("/").at(-1)!;
    const firstPage = await loadOrFetchSource(
      createArtistSource(
        artistId,
        index,
        rankedArtistUrls.length,
        1,
        ARTIST_PAGE_SIZE,
      ),
      checkpoint,
      requestState,
      options.refresh,
    );
    const excludedByCategory = excludedArtistNames.has(
      firstPage.artistName ?? "",
    );

    if (excludedByCategory) {
      excludedRankedArtistCount += 1;
      parsedSources.push({
        ...firstPage,
        candidates: [],
        excludedByCategory: true,
      });
      console.log(
        `按分类排除歌手：${firstPage.artistName} (${artistUrl})`,
      );
      continue;
    }

    selectedArtistCount += 1;
    parsedSources.push(firstPage);

    if ((firstPage.totalCount ?? 0) > ARTIST_PAGE_SIZE) {
      parsedSources.push(
        await loadOrFetchSource(
          createArtistSource(
            artistId,
            index,
            rankedArtistUrls.length,
            2,
            ARTIST_LIMIT - ARTIST_PAGE_SIZE,
          ),
          checkpoint,
          requestState,
          options.refresh,
        ),
      );
    }
  }

  for (const source of createHeiseiSources()) {
    parsedSources.push(
      await loadOrFetchSource(
        source,
        checkpoint,
        requestState,
        options.refresh,
      ),
    );
  }

  const output = createOutput(
    parsedSources,
    productionCatalog,
    {
      rankedArtistCount: rankedArtistUrls.length,
      excludedRankedArtistCount,
      selectedArtistCount,
    },
  );
  await writeJsonAtomic(OUTPUT_PATH, output);
  printSummary(output);
}

function createExclusionSources(): ExpansionSource[] {
  return [
    createExclusionSource(
      "excluded-enka-weekly",
      "演歌周榜排除歌手",
      "/web/karaoke/ranking/enka/weekly",
      "enka",
    ),
    createExclusionSource(
      "excluded-enka-monthly",
      "演歌月榜排除歌手",
      "/web/karaoke/ranking/enka/monthly",
      "enka",
    ),
    createExclusionSource(
      "excluded-foreign-weekly",
      "洋乐周榜排除歌手",
      "/web/karaoke/ranking/foreign/weekly",
      "foreign",
    ),
    createExclusionSource(
      "excluded-foreign-monthly",
      "洋乐月榜排除歌手",
      "/web/karaoke/ranking/foreign/monthly",
      "foreign",
    ),
  ];
}

function createExclusionSource(
  id: string,
  label: string,
  path: string,
  category: "enka" | "foreign",
): ExpansionSource {
  return {
    id,
    label,
    url: `https://www.joysound.com${path}`,
    parser: "excluded-artists",
    category,
  };
}

function createArtistSource(
  artistId: string,
  index: number,
  artistCount: number,
  page: number,
  limit: number,
): ExpansionSource {
  return {
    id: `expanded-artist-${artistId}-page-${page}`,
    label:
      `热门歌手 ${index + 1}/${artistCount}` +
      ` 第 ${page} 页`,
    url:
      `https://www.joysound.com/web/search/artist/${artistId}` +
      `?sort=popular&page=${page}`,
    parser: "artist-catalog",
    artistId,
    page,
    limit,
  };
}

function createHeiseiSources(): ExpansionSource[] {
  return [
    {
      id: "heisei-1996-1999",
      label: "平成榜 1996～1999",
      url:
        "https://www.joysound.com/web/s/karaoke/feature/" +
        "heisei/90s/",
      parser: "heisei",
      years: range(1996, 1999),
    },
    {
      id: "heisei-2000-2009",
      label: "平成榜 2000～2009",
      url:
        "https://www.joysound.com/web/s/karaoke/feature/" +
        "heisei/00s/",
      parser: "heisei",
      years: range(2000, 2009),
    },
    {
      id: "heisei-2010-2011",
      label: "平成榜 2010～2011",
      url:
        "https://www.joysound.com/web/s/karaoke/feature/" +
        "heisei/10s/",
      parser: "heisei",
      years: range(2010, 2011),
    },
  ];
}

async function loadOrFetchSource(
  source: ExpansionSource,
  checkpoint: Checkpoint,
  requestState: { count: number; lastRequestAt: number },
  refresh: boolean,
): Promise<ParsedSource> {
  const saved = checkpoint.items[source.id];

  if (
    !refresh &&
    saved &&
    JSON.stringify(saved.source) === JSON.stringify(source)
  ) {
    console.log(`使用扩展检查点：${source.label}`);
    return saved;
  }

  await waitForRequestSlot(requestState);
  console.log(`读取扩展入口：${source.label} ${source.url}`);
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
        candidates: [],
        excludedArtistNames: [],
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
  source: ExpansionSource,
  html: string,
): ParsedSource {
  if (source.parser === "artist-catalog") {
    const page = extractArtistCatalogPage(html);

    if (page.totalCount > 0 && page.songUrls.length === 0) {
      throw new Error(`${source.url} 有曲目数量但没有解析到歌曲链接`);
    }

    return {
      source,
      status: "success",
      fetchedAt: new Date().toISOString(),
      candidates: page.songUrls
        .slice(0, source.limit)
        .map((url, index) => ({
          url,
          sections: ["popular-artist-expanded"],
          rank: page.startIndex + index,
        })),
      excludedArtistNames: [],
      artistName: extractArtistName(html),
      totalCount: page.totalCount,
    };
  }

  if (source.parser === "heisei") {
    const urlsByYear = extractHeiseiYearSongUrls(
      html,
      source.years,
    );
    const candidatesByUrl = new Map<string, ParsedCandidate>();

    for (const year of source.years) {
      for (const url of urlsByYear[String(year)] ?? []) {
        const candidate = candidatesByUrl.get(url) ?? {
          url,
          sections: ["heisei-1996-2011"],
          years: [],
        };
        candidate.years!.push(year);
        candidatesByUrl.set(url, candidate);
      }
    }

    return {
      source,
      status: "success",
      fetchedAt: new Date().toISOString(),
      candidates: [...candidatesByUrl.values()],
      excludedArtistNames: [],
    };
  }

  return {
    source,
    status: "success",
    fetchedAt: new Date().toISOString(),
    candidates: [],
    excludedArtistNames: extractRankingArtistNames(html),
  };
}

function extractArtistName(html: string): string {
  const match = html.match(
    /<h1[^>]*>([\s\S]*?)<\/h1>/i,
  );

  return (match?.[1] ?? "")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, "\"")
    .replace(/\s+/g, " ")
    .trim();
}

function createOutput(
  parsedSources: ParsedSource[],
  productionCatalog: ProductionCatalog,
  artistSummary: {
    rankedArtistCount: number;
    excludedRankedArtistCount: number;
    selectedArtistCount: number;
  },
) {
  const candidateMap = new Map<
    string,
    Map<string, CandidateSource>
  >();

  for (const parsed of parsedSources) {
    if (parsed.excludedByCategory) {
      continue;
    }

    for (const candidate of parsed.candidates) {
      const sources =
        candidateMap.get(candidate.url) ??
        new Map<string, CandidateSource>();
      sources.set(parsed.source.id, {
        sourceId: parsed.source.id,
        sections: candidate.sections,
        ...(candidate.rank ? { rank: candidate.rank } : {}),
        ...(candidate.years?.length
          ? { years: candidate.years }
          : {}),
      });
      candidateMap.set(candidate.url, sources);
    }
  }

  const productionUrls = new Set(
    productionCatalog.songs.map((song) => song.sourceUrl),
  );
  const entries = [...candidateMap.entries()]
    .map(([url, sources]) => ({
      url,
      alreadyInProductionCatalog: productionUrls.has(url),
      sources: [...sources.values()].sort((first, second) =>
        first.sourceId.localeCompare(second.sourceId),
      ),
    }))
    .sort((first, second) => first.url.localeCompare(second.url));
  const newEntries = entries.filter(
    (entry) => !entry.alreadyInProductionCatalog,
  );
  const successfulSources = parsedSources.filter(
    (source) => source.status === "success",
  );

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    policy: {
      artistLimit: ARTIST_LIMIT,
      artistOrder: "JOYSOUND 歌手曲一覧的人気順",
      historicalYears: "1996-2011",
      requiredCategories: ["anime", "vocaloid"],
      excludedCategories: [
        "演歌／歌謡曲",
        "洋楽",
        "K-POP／韓国曲",
      ],
      exclusionRule:
        "当前演歌或洋乐周榜、月榜中的歌手不进入扩展歌手池",
    },
    summary: {
      ...artistSummary,
      requestedSourcePages: parsedSources.length,
      successfulSourcePages: successfulSources.length,
      unavailableSourcePages:
        parsedSources.length - successfulSources.length,
      uniqueSongPages: entries.length,
      alreadyInProductionCatalogPages: entries.length - newEntries.length,
      newForProductionPages: newEntries.length,
      artistExpandedPages: entries.filter((entry) =>
        entry.sources.some((source) =>
          source.sections.includes("popular-artist-expanded"),
        ),
      ).length,
      heiseiPages: entries.filter((entry) =>
        entry.sources.some((source) =>
          source.sections.includes("heisei-1996-2011"),
        ),
      ).length,
    },
    sources: parsedSources.map((parsed) => ({
      id: parsed.source.id,
      label: parsed.source.label,
      url: parsed.source.url,
      parser: parsed.source.parser,
      status: parsed.status,
      candidateCount: parsed.candidates.length,
      excludedArtistCount: parsed.excludedArtistNames.length,
      ...(parsed.excludedByCategory
        ? { excludedByCategory: true }
        : {}),
      ...(parsed.artistName
        ? { artistName: parsed.artistName }
        : {}),
      ...(typeof parsed.totalCount === "number"
        ? { totalCount: parsed.totalCount }
        : {}),
      ...(parsed.error ? { error: parsed.error } : {}),
    })),
    entries,
  };
}

function validateInputs(
  priorIndex: PriorCandidateIndex,
  productionCatalog: ProductionCatalog,
) {
  if (
    priorIndex.schemaVersion !== 1 ||
    !Array.isArray(priorIndex.sources)
  ) {
    throw new Error("榜单候选索引格式无效或版本不受支持");
  }
  if (!Array.isArray(productionCatalog.songs)) {
    throw new Error("生产曲库格式无效");
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
    const batchPauseMs = randomIntegerInclusive(
      MINIMUM_BATCH_PAUSE_MS,
      MAXIMUM_BATCH_PAUSE_MS,
    );
    console.log(
      `已完成 ${requestState.count} 个扩展入口请求，` +
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
  const remaining =
    delay - (Date.now() - requestState.lastRequestAt);

  if (remaining > 0) {
    await sleep(remaining);
  }
}

async function fetchText(
  url: string,
  retries: number,
): Promise<string> {
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const response = await fetch(url, {
      headers: {
        Accept: "text/html,*/*;q=0.8",
        "Accept-Language": "ja,en;q=0.8",
        "User-Agent":
          "joysound-helper/0.3 (authorized expanded discovery; rate limited)",
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
      const retryAfterMs =
        parseRetryAfter(response.headers.get("retry-after")) ??
        60_000 * 2 ** attempt;
      console.warn(
        `${error.message}，${retryAfterMs}ms 后重试`,
      );
      await sleep(retryAfterMs);
      continue;
    }

    if (response.status >= 500) {
      const retryDelayMs = 5_000 * 2 ** attempt;
      console.warn(
        `${error.message}，${retryDelayMs}ms 后重试`,
      );
      await sleep(retryDelayMs);
      continue;
    }

    throw error;
  }

  throw new Error(`${url} 重试后仍然失败`);
}

function parseRetryAfter(value: string | null): number | undefined {
  if (!value) {
    return undefined;
  }

  const seconds = Number(value);

  if (Number.isFinite(seconds)) {
    return Math.max(0, seconds * 1_000);
  }

  const date = Date.parse(value);
  return Number.isNaN(date)
    ? undefined
    : Math.max(0, date - Date.now());
}

async function loadCheckpoint(): Promise<Checkpoint> {
  try {
    const parsed = await readJson<Checkpoint>(CHECKPOINT_PATH);

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

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T;
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

function range(start: number, end: number): number[] {
  return Array.from(
    { length: end - start + 1 },
    (_, index) => start + index,
  );
}

function randomIntegerInclusive(
  minimum: number,
  maximum: number,
) {
  return (
    minimum +
    Math.floor(Math.random() * (maximum - minimum + 1))
  );
}

function sleep(milliseconds: number) {
  return new Promise((resolvePromise) =>
    setTimeout(resolvePromise, milliseconds),
  );
}

function printSummary(
  output: ReturnType<typeof createOutput>,
) {
  const { summary } = output;

  console.log(`扩展候选索引：${resolve(OUTPUT_PATH)}`);
  console.log(
    `歌手池：原始 ${summary.rankedArtistCount}，` +
      `排除 ${summary.excludedRankedArtistCount}，` +
      `保留 ${summary.selectedArtistCount}`,
  );
  console.log(
    `入口页面：成功 ${summary.successfulSourcePages}/` +
      `${summary.requestedSourcePages}，` +
      `不可用 ${summary.unavailableSourcePages}`,
  );
  console.log(
    `唯一歌曲页面 ${summary.uniqueSongPages}；` +
      `生产已有 ${summary.alreadyInProductionCatalogPages}，` +
      `待新增 ${summary.newForProductionPages}`,
  );
}

function printHelp() {
  console.log(`JOYSOUND 热门歌手与近三十年榜单扩展发现

用法：
  bun run discover:expanded -- --confirm-authorized-discovery

参数：
  --confirm-authorized-discovery  确认允许低速读取官方入口
  --refresh                       忽略扩展检查点并重新读取
  --help                          显示帮助
`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
