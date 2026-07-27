import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import {
  createArtistPageUrl,
  createCheckpointArtist,
  createFullArtistCandidateIndex,
  expectedArtistPageRange,
  extractFullArtistSeeds,
  resetCheckpointArtistTotalCount,
  summarizeCheckpointArtist,
  validateSuccessfulArtistPage,
  type FullArtistDiscoveryCheckpoint,
  type FullArtistPageCheckpoint,
  type FullArtistSeed,
} from "./lib/joysound-full-artist";
import { extractArtistCatalogPage } from "./lib/joysound-ranking";

const DEFAULT_INPUT_INDEX_PATH =
  "src/data/generated/joysound-expanded-candidates.json";
const DEFAULT_PRODUCTION_CATALOG_PATH =
  "src/data/generated/joysound-expanded-catalog.json";
const DEFAULT_OUTPUT_PATH =
  "src/data/generated/joysound-full-artist-candidates.json";
const DEFAULT_CHECKPOINT_PATH =
  ".cache/joysound-full-artist-discovery/checkpoint.json";
const DEFAULT_HISTORICAL_CHECKPOINT_PATH =
  ".cache/joysound-expanded-discovery/checkpoint.json";
const DEFAULT_LIMIT = 20;
const DEFAULT_DELAY_MS = 5_000;
const DEFAULT_JITTER_MS = 2_000;
const DEFAULT_BATCH_SIZE = 50;
const DEFAULT_BATCH_PAUSE_MIN_MS = 45_000;
const DEFAULT_BATCH_PAUSE_MAX_MS = 60_000;
const MINIMUM_DELAY_MS = 3_000;
const MINIMUM_LARGE_RUN_BATCH_PAUSE_MS = 45_000;
const LARGE_RUN_THRESHOLD = 50;
const RATE_LIMIT_BACKOFF_MS = 60_000;

type ExpandedCandidates = Parameters<
  typeof extractFullArtistSeeds
>[0];

type ProductionCatalog = Parameters<
  typeof createFullArtistCandidateIndex
>[1];

type HistoricalCheckpoint = {
  schemaVersion: number;
  items: Record<
    string,
    {
      source: {
        parser: string;
        artistId?: string;
        page?: number;
        url: string;
      };
      status: string;
      fetchedAt: string;
      candidates: Array<{ url: string }>;
      totalCount?: number;
    }
  >;
};

type CliOptions = {
  inputIndexPath: string;
  productionCatalogPath: string;
  outputPath: string;
  checkpointPath: string;
  historicalCheckpointPath: string;
  limit: number;
  delayMs: number;
  jitterMs: number;
  batchSize: number;
  batchPauseMinMs: number;
  batchPauseMaxMs: number;
  retries: number;
  refresh: boolean;
  dryRun: boolean;
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

  validateOptions(options);

  const inputIndexPath = resolve(options.inputIndexPath);
  const expandedCandidates = await readJson<ExpandedCandidates>(
    inputIndexPath,
  );
  const productionCatalog = await readJson<ProductionCatalog>(
    options.productionCatalogPath,
  );
  const seeds = extractFullArtistSeeds(expandedCandidates);
  let checkpoint = await loadCheckpoint(
    options.checkpointPath,
    inputIndexPath,
  );

  checkpoint = reconcileCheckpoint(
    checkpoint,
    seeds,
    options.refresh,
  );

  if (!options.refresh) {
    const importedPages = await importHistoricalCheckpoint(
      checkpoint,
      seeds,
      options.historicalCheckpointPath,
    );

    if (importedPages > 0) {
      console.log(
        `已迁移 ${importedPages} 个通过完整性校验的历史分页`,
      );
    }
  }

  const initiallyInvalidatedPages =
    invalidateInconsistentImportedPages(checkpoint);

  if (initiallyInvalidatedPages > 0) {
    console.warn(
      `检测到历史分页与当前排序漂移，` +
        `已将 ${initiallyInvalidatedPages} 个历史分页重新标记为待处理`,
    );
  }

  await saveCheckpoint(options.checkpointPath, checkpoint);

  const plannedPages = createPendingPagePlan(checkpoint, seeds);
  const selectedPages = plannedPages.slice(0, options.limit);
  const checkpointArtists = Object.values(checkpoint.artists);

  console.log(
    `目标歌手 ${seeds.length} 位，声明曲目 ` +
      `${checkpointArtists.reduce(
        (count, artist) =>
          count + artist.declaredTotalCount,
        0,
      )} 条，` +
      `计划分页 ${checkpointArtists.reduce(
        (count, artist) => count + artist.plannedPages,
        0,
      )} 页`,
  );
  console.log(
    `检查点后待读取 ${plannedPages.length} 页，本次计划 ${selectedPages.length} 页`,
  );

  if (options.dryRun) {
    for (const item of selectedPages.slice(0, 10)) {
      console.log(
        `- ${item.seed.artistName} 第 ${item.page} 页 ${item.url}`,
      );
    }
    await writeCandidateIndex(
      checkpoint,
      productionCatalog,
      options.outputPath,
    );
    return;
  }

  const requestState = { count: 0, lastRequestAt: 0 };

  for (const [index, item] of selectedPages.entries()) {
    await waitForRequestSlot(requestState, options);
    console.log(
      `[${index + 1}/${selectedPages.length}] 获取：` +
        `${item.seed.artistName} 第 ${item.page} 页 ${item.url}`,
    );
    requestState.count += 1;
    requestState.lastRequestAt = Date.now();

    let pageResult: FullArtistPageCheckpoint;

    try {
      const html = await fetchText(item.url, options.retries);
      const parsed = extractArtistCatalogPage(html);
      let activeArtist =
        checkpoint.artists[item.seed.artistId]!;
      let activeSeed = toSeed(activeArtist);

      if (
        parsed.totalCount !== activeSeed.declaredTotalCount
      ) {
        console.warn(
          `${activeSeed.artistName} 声明总数发生变化：` +
            `${activeSeed.declaredTotalCount} → ${parsed.totalCount}；` +
            "重建该歌手的分页检查点",
        );
        activeArtist = resetCheckpointArtistTotalCount(
          activeArtist,
          parsed.totalCount,
        );
        checkpoint.artists[item.seed.artistId] = activeArtist;
        activeSeed = toSeed(activeArtist);
      }

      validateSuccessfulArtistPage(activeSeed, item.page, parsed);
      pageResult = {
        page: item.page,
        url: item.url,
        status: "success",
        fetchedAt: new Date().toISOString(),
        startIndex: parsed.startIndex,
        endIndex: parsed.endIndex,
        candidateUrls: parsed.songUrls,
      };
    } catch (error) {
      const unavailable =
        error instanceof HttpStatusError && error.status === 404;
      pageResult = {
        page: item.page,
        url: item.url,
        status: unavailable ? "unavailable" : "error",
        fetchedAt: new Date().toISOString(),
        candidateUrls: [],
        error: error instanceof Error ? error.message : String(error),
      };
    }

    const artist = checkpoint.artists[item.seed.artistId]!;
    artist.pages[String(item.page)] = pageResult;
    checkpoint.artists[item.seed.artistId] =
      summarizeCheckpointArtist(artist);
    await saveCheckpoint(options.checkpointPath, checkpoint);

    if (
      pageResult.status === "error" &&
      pageResult.error &&
      /返回 HTTP (403|429)/.test(pageResult.error)
    ) {
      throw new Error(
        `${pageResult.error}；已停止发现任务，` +
          "不会切换 IP 或绕过访问限制",
      );
    }
    if (pageResult.status === "error") {
      console.warn(`记录分页错误：${pageResult.error}`);
    }
  }

  const invalidatedPages =
    invalidateInconsistentImportedPages(checkpoint);

  if (invalidatedPages > 0) {
    console.warn(
      `检测到历史分页与当前排序漂移，` +
        `已将 ${invalidatedPages} 个历史分页重新标记为待处理`,
    );
    await saveCheckpoint(options.checkpointPath, checkpoint);
  }

  const output = await writeCandidateIndex(
    checkpoint,
    productionCatalog,
    options.outputPath,
  );
  printSummary(output, options);
}

function invalidateInconsistentImportedPages(
  checkpoint: FullArtistDiscoveryCheckpoint,
): number {
  let invalidatedPages = 0;

  for (const artist of Object.values(checkpoint.artists)) {
    const summarized = summarizeCheckpointArtist(artist);
    const fullySuccessful =
      summarized.successfulPages === summarized.plannedPages &&
      summarized.unavailablePages === 0 &&
      summarized.errorPages === 0 &&
      summarized.pendingPages === 0;

    if (
      !fullySuccessful ||
      summarized.candidateUrls.length ===
        summarized.declaredTotalCount
    ) {
      continue;
    }

    for (const [page, saved] of Object.entries(artist.pages)) {
      if (saved.importedFrom) {
        delete artist.pages[page];
        invalidatedPages += 1;
      }
    }

    checkpoint.artists[artist.artistId] =
      summarizeCheckpointArtist(artist);
  }

  return invalidatedPages;
}

function reconcileCheckpoint(
  checkpoint: FullArtistDiscoveryCheckpoint,
  seeds: FullArtistSeed[],
  refresh: boolean,
): FullArtistDiscoveryCheckpoint {
  const artists = Object.fromEntries(
    seeds.map((seed) => {
      const saved = refresh
        ? undefined
        : checkpoint.artists[seed.artistId];
      const savedIdentityMatches =
        saved?.artistId === seed.artistId &&
        saved.artistName === seed.artistName &&
        saved.artistUrl === seed.artistUrl;
      const effectiveSeed =
        savedIdentityMatches &&
        Number.isSafeInteger(saved.declaredTotalCount) &&
        saved.declaredTotalCount > 0
          ? toSeed(saved)
          : seed;

      return [
        seed.artistId,
        createCheckpointArtist(effectiveSeed, saved),
      ];
    }),
  );

  return {
    schemaVersion: 1,
    updatedAt: new Date().toISOString(),
    sourceIndexPath: checkpoint.sourceIndexPath,
    artists,
  };
}

function toSeed(
  artist: FullArtistDiscoveryCheckpoint["artists"][string],
): FullArtistSeed {
  return {
    artistId: artist.artistId,
    artistName: artist.artistName,
    artistUrl: artist.artistUrl,
    declaredTotalCount: artist.declaredTotalCount,
    plannedPages: artist.plannedPages,
  };
}

async function importHistoricalCheckpoint(
  checkpoint: FullArtistDiscoveryCheckpoint,
  seeds: FullArtistSeed[],
  path: string,
): Promise<number> {
  let historical: HistoricalCheckpoint;

  try {
    historical = await readJson<HistoricalCheckpoint>(path);
  } catch {
    return 0;
  }

  if (historical.schemaVersion !== 1 || !historical.items) {
    return 0;
  }

  const seedsById = new Map(
    seeds.map((seed) => [seed.artistId, seed]),
  );
  let importedPages = 0;

  for (const saved of Object.values(historical.items)) {
    const artistId = saved.source.artistId;
    const page = saved.source.page;

    if (
      saved.source.parser !== "artist-catalog" ||
      !artistId ||
      !page ||
      saved.status !== "success" ||
      typeof saved.totalCount !== "number"
    ) {
      continue;
    }

    const seed = seedsById.get(artistId);
    const target = checkpoint.artists[artistId];

    if (
      !seed ||
      !target ||
      target.pages[String(page)] ||
      Object.values(target.pages).some(
        (savedPage) => !savedPage.importedFrom,
      )
    ) {
      continue;
    }

    const expected = expectedArtistPageRange(seed, page);
    const candidateUrls = saved.candidates.map(
      (candidate) => candidate.url,
    );

    try {
      validateSuccessfulArtistPage(seed, page, {
        totalCount: saved.totalCount,
        startIndex: expected.startIndex,
        endIndex: expected.endIndex,
        songUrls: candidateUrls,
      });
    } catch {
      // 历史第 2 页只保存前 10 条时不能当作完整分页复用。
      continue;
    }

    target.pages[String(page)] = {
      page,
      url: createArtistPageUrl(artistId, page),
      status: "success",
      fetchedAt: saved.fetchedAt,
      startIndex: expected.startIndex,
      endIndex: expected.endIndex,
      candidateUrls,
      importedFrom: resolve(path),
    };
    checkpoint.artists[artistId] =
      summarizeCheckpointArtist(target);
    importedPages += 1;
  }

  return importedPages;
}

function createPendingPagePlan(
  checkpoint: FullArtistDiscoveryCheckpoint,
  seeds: FullArtistSeed[],
) {
  return seeds.flatMap((seed) => {
    const artist = checkpoint.artists[seed.artistId]!;

    return Array.from(
      { length: seed.plannedPages },
      (_, index) => index + 1,
    )
      .filter((page) => {
        const saved = artist.pages[String(page)];
        return (
          !saved ||
          saved.status === "error"
        );
      })
      .map((page) => ({
        seed,
        page,
        url: createArtistPageUrl(seed.artistId, page),
      }));
  });
}

async function writeCandidateIndex(
  checkpoint: FullArtistDiscoveryCheckpoint,
  productionCatalog: ProductionCatalog,
  outputPath: string,
) {
  const output = createFullArtistCandidateIndex(
    checkpoint,
    productionCatalog,
  );
  await writeJsonAtomic(outputPath, output);
  console.log(`已生成候选索引：${resolve(outputPath)}`);
  return output;
}

async function waitForRequestSlot(
  requestState: { count: number; lastRequestAt: number },
  options: CliOptions,
) {
  if (
    requestState.count > 0 &&
    requestState.count % options.batchSize === 0
  ) {
    const batchPauseMs = randomIntegerInclusive(
      options.batchPauseMinMs,
      options.batchPauseMaxMs,
    );
    console.log(
      `已完成 ${requestState.count} 个真实分页请求，` +
        `随机冷却 ${batchPauseMs}ms`,
    );
    await sleep(batchPauseMs);
    requestState.lastRequestAt = 0;
  }

  if (requestState.lastRequestAt === 0) {
    return;
  }

  const requiredDelay =
    options.delayMs +
    Math.floor(Math.random() * (options.jitterMs + 1));
  const remaining =
    requiredDelay -
    (Date.now() - requestState.lastRequestAt);

  if (remaining > 0) {
    await sleep(remaining);
  }
}

async function fetchText(
  url: string,
  retries: number,
): Promise<string> {
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    let response: Response;

    try {
      response = await fetch(url, {
        headers: {
          Accept: "text/html,*/*;q=0.8",
          "Accept-Language": "ja,en;q=0.8",
          "User-Agent":
            "joysound-helper/0.4 " +
            "(authorized full artist discovery; rate limited)",
        },
        signal: AbortSignal.timeout(30_000),
      });
    } catch (error) {
      if (attempt === retries) {
        throw error;
      }
      await sleep(2 ** attempt * 1_000);
      continue;
    }

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
        RATE_LIMIT_BACKOFF_MS * 2 ** attempt;
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

async function loadCheckpoint(
  path: string,
  sourceIndexPath: string,
): Promise<FullArtistDiscoveryCheckpoint> {
  try {
    const parsed = await readJson<FullArtistDiscoveryCheckpoint>(path);

    if (
      parsed.schemaVersion === 1 &&
      parsed.sourceIndexPath === sourceIndexPath &&
      parsed.artists
    ) {
      return parsed;
    }
  } catch {
    // 文件不存在或格式过期时从空检查点开始。
  }

  return {
    schemaVersion: 1,
    updatedAt: new Date().toISOString(),
    sourceIndexPath,
    artists: {},
  };
}

async function saveCheckpoint(
  path: string,
  checkpoint: FullArtistDiscoveryCheckpoint,
) {
  checkpoint.updatedAt = new Date().toISOString();
  await writeJsonAtomic(path, checkpoint);
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
    inputIndexPath: DEFAULT_INPUT_INDEX_PATH,
    productionCatalogPath: DEFAULT_PRODUCTION_CATALOG_PATH,
    outputPath: DEFAULT_OUTPUT_PATH,
    checkpointPath: DEFAULT_CHECKPOINT_PATH,
    historicalCheckpointPath:
      DEFAULT_HISTORICAL_CHECKPOINT_PATH,
    limit: DEFAULT_LIMIT,
    delayMs: DEFAULT_DELAY_MS,
    jitterMs: DEFAULT_JITTER_MS,
    batchSize: DEFAULT_BATCH_SIZE,
    batchPauseMinMs: DEFAULT_BATCH_PAUSE_MIN_MS,
    batchPauseMaxMs: DEFAULT_BATCH_PAUSE_MAX_MS,
    retries: 3,
    refresh: false,
    dryRun: false,
    confirmAuthorizedDiscovery: false,
    help: false,
  };

  for (const argument of args) {
    if (argument === "--refresh") {
      options.refresh = true;
    } else if (argument === "--dry-run") {
      options.dryRun = true;
    } else if (argument === "--confirm-authorized-discovery") {
      options.confirmAuthorizedDiscovery = true;
    } else if (argument === "--help" || argument === "-h") {
      options.help = true;
    } else if (argument.startsWith("--input-index=")) {
      options.inputIndexPath = argument.slice(
        "--input-index=".length,
      );
    } else if (argument.startsWith("--production-catalog=")) {
      options.productionCatalogPath = argument.slice(
        "--production-catalog=".length,
      );
    } else if (argument.startsWith("--output=")) {
      options.outputPath = argument.slice("--output=".length);
    } else if (argument.startsWith("--checkpoint=")) {
      options.checkpointPath = argument.slice(
        "--checkpoint=".length,
      );
    } else if (argument.startsWith("--historical-checkpoint=")) {
      options.historicalCheckpointPath = argument.slice(
        "--historical-checkpoint=".length,
      );
    } else if (argument.startsWith("--limit=")) {
      options.limit = parseIntegerOption(
        "limit",
        argument.slice("--limit=".length),
      );
    } else if (argument.startsWith("--delay-ms=")) {
      options.delayMs = parseIntegerOption(
        "delay-ms",
        argument.slice("--delay-ms=".length),
      );
    } else if (argument.startsWith("--jitter-ms=")) {
      options.jitterMs = parseIntegerOption(
        "jitter-ms",
        argument.slice("--jitter-ms=".length),
      );
    } else if (argument.startsWith("--batch-size=")) {
      options.batchSize = parseIntegerOption(
        "batch-size",
        argument.slice("--batch-size=".length),
      );
    } else if (argument.startsWith("--batch-pause-min-ms=")) {
      options.batchPauseMinMs = parseIntegerOption(
        "batch-pause-min-ms",
        argument.slice("--batch-pause-min-ms=".length),
      );
    } else if (argument.startsWith("--batch-pause-max-ms=")) {
      options.batchPauseMaxMs = parseIntegerOption(
        "batch-pause-max-ms",
        argument.slice("--batch-pause-max-ms=".length),
      );
    } else if (argument.startsWith("--retries=")) {
      options.retries = parseIntegerOption(
        "retries",
        argument.slice("--retries=".length),
      );
    } else {
      throw new Error(`未知参数：${argument}`);
    }
  }

  return options;
}

function validateOptions(options: CliOptions) {
  if (
    options.limit < 1 ||
    options.delayMs < MINIMUM_DELAY_MS ||
    options.jitterMs < 0 ||
    options.batchSize < 1 ||
    options.batchPauseMinMs < 0 ||
    options.batchPauseMaxMs < options.batchPauseMinMs ||
    options.retries < 0
  ) {
    throw new Error(
      `limit 和 batch-size 必须大于 0；delay-ms 不能低于 ` +
        `${MINIMUM_DELAY_MS}；其余时间与 retries 不能为负数`,
    );
  }
  if (
    options.limit > LARGE_RUN_THRESHOLD &&
    !options.dryRun &&
    !options.confirmAuthorizedDiscovery
  ) {
    throw new Error(
      `超过 ${LARGE_RUN_THRESHOLD} 个入口页属于大规模发现；` +
        "确认授权后请添加 --confirm-authorized-discovery",
    );
  }
  if (
    options.limit > LARGE_RUN_THRESHOLD &&
    !options.dryRun &&
    options.batchPauseMinMs <
      MINIMUM_LARGE_RUN_BATCH_PAUSE_MS
  ) {
    throw new Error(
      "大规模发现的 batch-pause-min-ms 不能低于 " +
        `${MINIMUM_LARGE_RUN_BATCH_PAUSE_MS}`,
    );
  }
}

function parseIntegerOption(name: string, value: string): number {
  const parsed = Number(value);

  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`${name} 必须是整数`);
  }

  return parsed;
}

function sleep(milliseconds: number) {
  return new Promise((resolvePromise) =>
    setTimeout(resolvePromise, milliseconds),
  );
}

function randomIntegerInclusive(minimum: number, maximum: number) {
  return (
    minimum +
    Math.floor(Math.random() * (maximum - minimum + 1))
  );
}

function printSummary(
  output: ReturnType<typeof createFullArtistCandidateIndex>,
  options: CliOptions,
) {
  const { summary } = output;

  console.log(
    `分页状态：成功 ${summary.successfulSourcePages}，` +
      `不可用 ${summary.unavailableSourcePages}，` +
      `错误 ${summary.errorSourcePages}，` +
      `待处理 ${summary.pendingSourcePages}，` +
      `跨页不一致歌手 ${summary.inconsistentArtists}`,
  );
  console.log(
    `候选结果：${summary.uniqueSongPages} 个唯一歌曲页，` +
      `生产已有 ${summary.alreadyInProductionCatalogPages}，` +
      `待新增 ${summary.newForProductionPages}`,
  );
  console.log(
    `发现验收：${output.discoveryReady ? "通过" : "未完成"}`,
  );
  console.log(`检查点：${resolve(options.checkpointPath)}`);
}

function printHelp() {
  console.log(`JOYSOUND 热门歌手全曲目发现器

用法：
  bun run discover:full-artists -- [参数]

参数：
  --dry-run                         迁移检查点并输出计划，不请求官方页面
  --limit=N                         本轮最多读取的待处理分页，默认 ${DEFAULT_LIMIT}
  --delay-ms=N                      请求基础间隔，默认 ${DEFAULT_DELAY_MS}ms
  --jitter-ms=N                     随机附加间隔，默认 ${DEFAULT_JITTER_MS}ms
  --batch-size=N                    每批真实请求数，默认 ${DEFAULT_BATCH_SIZE}
  --batch-pause-min-ms=N            最短批次冷却，默认 ${DEFAULT_BATCH_PAUSE_MIN_MS}ms
  --batch-pause-max-ms=N            最长批次冷却，默认 ${DEFAULT_BATCH_PAUSE_MAX_MS}ms
  --retries=N                       429/5xx 最大重试次数，默认 3
  --refresh                         清空新检查点并重新读取全部分页
  --input-index=PATH                热门歌手扩展候选索引
  --production-catalog=PATH         当前生产曲库
  --output=PATH                     全曲目候选索引输出
  --checkpoint=PATH                 独立分页检查点
  --historical-checkpoint=PATH      可迁移的历史扩展检查点
  --confirm-authorized-discovery    确认已获授权并允许超过 ${LARGE_RUN_THRESHOLD} 页
  --help                            显示帮助
`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
