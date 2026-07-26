import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import type { Song } from "../src/types";
import type {
  CrawlCheckpoint as Checkpoint,
  CrawlCheckpointItem as CheckpointItem,
  CrawlStatus,
} from "./lib/joysound-catalog";
import {
  parseJoysoundSongPage,
  parseSitemapXml,
  type SitemapEntry,
  validateCrawlSongs,
} from "./lib/joysound-parser";

const DEFAULT_SITEMAP_URL =
  "https://www.joysound.com/sitemap/contents/sitemap-songs-popular.xml";
const DEFAULT_OUTPUT_PATH = "src/data/generated/joysound-songs.json";
const DEFAULT_CHECKPOINT_PATH =
  ".cache/joysound-crawler/checkpoint.json";
const DEFAULT_LIMIT = 20;
const DEFAULT_DELAY_MS = 5_000;
const DEFAULT_JITTER_MS = 2_000;
const DEFAULT_BATCH_SIZE = 100;
const DEFAULT_BATCH_PAUSE_MIN_MS = 45_000;
const DEFAULT_BATCH_PAUSE_MAX_MS = 60_000;
const LARGE_RUN_THRESHOLD = 50;
const MINIMUM_DELAY_MS = 3_000;
const MINIMUM_LARGE_RUN_BATCH_PAUSE_MS = 45_000;
const RATE_LIMIT_BACKOFF_MS = 60_000;
const SCHEMA_VERSION = 1;

type CliOptions = {
  sitemapUrl: string;
  inputIndexPath?: string;
  outputPath: string;
  checkpointPath: string;
  offset: number;
  limit: number;
  delayMs: number;
  jitterMs: number;
  batchSize: number;
  batchPauseMinMs: number;
  batchPauseMaxMs: number;
  retries: number;
  dryRun: boolean;
  indexOnly: boolean;
  newOnly: boolean;
  refresh: boolean;
  confirmAuthorizedLargeRun: boolean;
  help: boolean;
};

type CandidateIndex = {
  schemaVersion: number;
  entries: Array<{
    url: string;
    lastModified?: string;
    alreadyInProductionCatalog?: boolean;
  }>;
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
  const options = parseCliOptions(process.argv.slice(2));

  if (options.help) {
    printHelp();
    return;
  }

  validateOptions(options);

  const input = await loadInput(options);
  const entries = input.entries;

  if (entries.length === 0) {
    throw new Error("输入中没有找到有效的 JOYSOUND 歌曲链接");
  }

  console.log(`输入来源：${input.label}`);
  console.log(`发现 ${entries.length} 个官方歌曲页面`);

  if (options.dryRun) {
    const selectedEntries = selectEntries(entries, options);
    console.log(
      `试运行完成；计划从偏移 ${options.offset} 处理 ${selectedEntries.length} 个页面`,
    );
    for (const entry of selectedEntries.slice(0, 5)) {
      console.log(`- ${entry.url}${entry.lastModified ? ` (${entry.lastModified})` : ""}`);
    }
    return;
  }

  if (options.indexOnly) {
    const selectedEntries = selectEntries(entries, options);
    await writeJsonAtomic(options.outputPath, {
      schemaVersion: SCHEMA_VERSION,
      generatedAt: new Date().toISOString(),
      sitemapUrl: input.sourceIdentifier,
      totalEntries: entries.length,
      entries: selectedEntries,
    });
    console.log(
      `已生成 ${selectedEntries.length} 条候选索引：${resolve(options.outputPath)}`,
    );
    return;
  }

  const selectedEntries = selectEntries(entries, options);
  const checkpoint = await loadCheckpoint(
    options.checkpointPath,
    input.sourceIdentifier,
  );
  let lastRequestAt = 0;
  let requestCount = 0;

  for (const [index, entry] of selectedEntries.entries()) {
    const previous = checkpoint.items[entry.url];
    const canReuse =
      !options.refresh &&
      previous &&
      previous.status !== "error" &&
      previous.sourceLastModified === entry.lastModified;

    if (canReuse) {
      console.log(
        `[${index + 1}/${selectedEntries.length}] 使用检查点：${entry.url}`,
      );
      continue;
    }

    if (
      requestCount > 0 &&
      requestCount % options.batchSize === 0
    ) {
      const batchPauseMs = randomIntegerInclusive(
        options.batchPauseMinMs,
        options.batchPauseMaxMs,
      );
      console.log(
        `已完成 ${requestCount} 个真实请求，` +
          `随机冷却 ${batchPauseMs}ms`,
      );
      await sleep(batchPauseMs);
      lastRequestAt = 0;
    }

    const requiredDelay =
      options.delayMs + Math.floor(Math.random() * (options.jitterMs + 1));
    const elapsed = Date.now() - lastRequestAt;

    if (lastRequestAt > 0 && elapsed < requiredDelay) {
      await sleep(requiredDelay - elapsed);
    }

    console.log(
      `[${index + 1}/${selectedEntries.length}] 获取：${entry.url}`,
    );
    lastRequestAt = Date.now();
    requestCount += 1;

    try {
      const html = await fetchText(entry.url, options.retries);
      const song = parseJoysoundSongPage(html, entry.url);
      checkpoint.items[entry.url] = {
        status: song.variants.length > 0 ? "success" : "no-x1",
        sourceLastModified: entry.lastModified,
        attemptedAt: new Date().toISOString(),
        ...(song.variants.length > 0 ? { song } : {}),
      };
    } catch (error) {
      const status =
        error instanceof HttpStatusError && error.status === 404
          ? "unavailable"
          : "error";
      checkpoint.items[entry.url] = {
        status,
        sourceLastModified: entry.lastModified,
        attemptedAt: new Date().toISOString(),
        error: error instanceof Error ? error.message : String(error),
      };

      await saveCheckpoint(options.checkpointPath, checkpoint);

      if (
        error instanceof HttpStatusError &&
        (error.status === 403 || error.status === 429)
      ) {
        throw new Error(
          `服务器返回 ${error.status}，已停止采集；不会切换 IP 或绕过限制`,
        );
      }

      console.warn(
        `跳过 ${entry.url}：${error instanceof Error ? error.message : String(error)}`,
      );
      continue;
    }

    await saveCheckpoint(options.checkpointPath, checkpoint);
  }

  const songs = Object.values(checkpoint.items)
    .filter(
      (item): item is CheckpointItem & { song: Song } =>
        item.status === "success" && Boolean(item.song),
    )
    .map((item) => item.song)
    .sort((first, second) => first.sourceUrl.localeCompare(second.sourceUrl));
  const validationErrors = validateCrawlSongs(songs);

  if (validationErrors.length > 0) {
    throw new Error(
      `生成数据未通过校验：\n${validationErrors.map((error) => `- ${error}`).join("\n")}`,
    );
  }

  const generatedOutput = {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    sitemapUrl: input.sourceIdentifier,
    songs,
    stats: summarizeCheckpoint(checkpoint),
  };

  await writeJsonAtomic(options.outputPath, generatedOutput);
  console.log(`已生成 ${songs.length} 首歌曲：${resolve(options.outputPath)}`);
  console.log(`检查点：${resolve(options.checkpointPath)}`);
}

function parseCliOptions(args: string[]): CliOptions {
  const options: CliOptions = {
    sitemapUrl: DEFAULT_SITEMAP_URL,
    outputPath: DEFAULT_OUTPUT_PATH,
    checkpointPath: DEFAULT_CHECKPOINT_PATH,
    offset: 0,
    limit: DEFAULT_LIMIT,
    delayMs: DEFAULT_DELAY_MS,
    jitterMs: DEFAULT_JITTER_MS,
    batchSize: DEFAULT_BATCH_SIZE,
    batchPauseMinMs: DEFAULT_BATCH_PAUSE_MIN_MS,
    batchPauseMaxMs: DEFAULT_BATCH_PAUSE_MAX_MS,
    retries: 3,
    dryRun: false,
    indexOnly: false,
    newOnly: false,
    refresh: false,
    confirmAuthorizedLargeRun: false,
    help: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];

    if (argument === "--dry-run") {
      options.dryRun = true;
    } else if (argument === "--index-only") {
      options.indexOnly = true;
    } else if (argument === "--new-only") {
      options.newOnly = true;
    } else if (argument === "--refresh") {
      options.refresh = true;
    } else if (argument === "--confirm-authorized-large-run") {
      options.confirmAuthorizedLargeRun = true;
    } else if (argument === "--help" || argument === "-h") {
      options.help = true;
    } else if (argument?.startsWith("--sitemap=")) {
      options.sitemapUrl = argument.slice("--sitemap=".length);
    } else if (argument?.startsWith("--input-index=")) {
      options.inputIndexPath = argument.slice("--input-index=".length);
    } else if (argument?.startsWith("--output=")) {
      options.outputPath = argument.slice("--output=".length);
    } else if (argument?.startsWith("--checkpoint=")) {
      options.checkpointPath = argument.slice("--checkpoint=".length);
    } else if (argument?.startsWith("--offset=")) {
      options.offset = parseIntegerOption("offset", argument.slice(9));
    } else if (argument?.startsWith("--limit=")) {
      options.limit = parseIntegerOption("limit", argument.slice(8));
    } else if (argument?.startsWith("--delay-ms=")) {
      options.delayMs = parseIntegerOption("delay-ms", argument.slice(11));
    } else if (argument?.startsWith("--jitter-ms=")) {
      options.jitterMs = parseIntegerOption("jitter-ms", argument.slice(12));
    } else if (argument?.startsWith("--batch-size=")) {
      options.batchSize = parseIntegerOption(
        "batch-size",
        argument.slice("--batch-size=".length),
      );
    } else if (argument?.startsWith("--batch-pause-ms=")) {
      const batchPauseMs = parseIntegerOption(
        "batch-pause-ms",
        argument.slice("--batch-pause-ms=".length),
      );
      options.batchPauseMinMs = batchPauseMs;
      options.batchPauseMaxMs = batchPauseMs;
    } else if (argument?.startsWith("--batch-pause-min-ms=")) {
      options.batchPauseMinMs = parseIntegerOption(
        "batch-pause-min-ms",
        argument.slice("--batch-pause-min-ms=".length),
      );
    } else if (argument?.startsWith("--batch-pause-max-ms=")) {
      options.batchPauseMaxMs = parseIntegerOption(
        "batch-pause-max-ms",
        argument.slice("--batch-pause-max-ms=".length),
      );
    } else if (argument?.startsWith("--retries=")) {
      options.retries = parseIntegerOption("retries", argument.slice(10));
    } else {
      throw new Error(`未知参数：${argument}`);
    }
  }

  return options;
}

function validateOptions(options: CliOptions) {
  if (!options.inputIndexPath) {
    const sitemapUrl = new URL(options.sitemapUrl);

    if (
      sitemapUrl.protocol !== "https:" ||
      sitemapUrl.hostname !== "www.joysound.com" ||
      !sitemapUrl.pathname.startsWith("/sitemap/")
    ) {
      throw new Error(
        "Sitemap 必须是 www.joysound.com/sitemap/ 下的 HTTPS 链接",
      );
    }
  }
  if (options.inputIndexPath && options.indexOnly) {
    throw new Error("--input-index 不能与 --index-only 同时使用");
  }
  if (options.newOnly && !options.inputIndexPath) {
    throw new Error("--new-only 必须与 --input-index 同时使用");
  }
  if (options.offset < 0 || options.limit < 1) {
    throw new Error("offset 不能为负数，limit 必须大于 0");
  }
  if (options.delayMs < MINIMUM_DELAY_MS) {
    throw new Error(`delay-ms 不能低于 ${MINIMUM_DELAY_MS}`);
  }
  if (
    options.jitterMs < 0 ||
    options.batchSize < 1 ||
    options.batchPauseMinMs < 0 ||
    options.batchPauseMaxMs < 0 ||
    options.retries < 0
  ) {
    throw new Error(
      "jitter-ms、批次冷却时间和 retries 不能为负数，batch-size 必须大于 0",
    );
  }
  if (options.batchPauseMaxMs < options.batchPauseMinMs) {
    throw new Error(
      "batch-pause-max-ms 不能低于 batch-pause-min-ms",
    );
  }
  const isLargeRun =
    options.offset > 0 || options.limit > LARGE_RUN_THRESHOLD;

  if (
    isLargeRun &&
    !options.dryRun &&
    !options.indexOnly &&
    !options.confirmAuthorizedLargeRun
  ) {
    throw new Error(
      `处理首批以外的页面或超过 ${LARGE_RUN_THRESHOLD} 页属于大规模采集；取得授权后请显式添加 --confirm-authorized-large-run`,
    );
  }
  if (
    isLargeRun &&
    !options.dryRun &&
    !options.indexOnly &&
    options.batchPauseMinMs <
      MINIMUM_LARGE_RUN_BATCH_PAUSE_MS
  ) {
    throw new Error(
      `大规模采集的 batch-pause-min-ms 不能低于 ${MINIMUM_LARGE_RUN_BATCH_PAUSE_MS}`,
    );
  }
}

async function loadInput(options: CliOptions): Promise<{
  label: string;
  sourceIdentifier: string;
  entries: SitemapEntry[];
}> {
  if (options.inputIndexPath) {
    const absolutePath = resolve(options.inputIndexPath);
    const index = JSON.parse(
      await readFile(absolutePath, "utf8"),
    ) as CandidateIndex;

    if (index.schemaVersion !== SCHEMA_VERSION || !Array.isArray(index.entries)) {
      throw new Error("本地候选索引格式无效或版本不受支持");
    }

    const selectedEntries = index.entries
      .filter(
        (entry) =>
          !options.newOnly || !entry.alreadyInProductionCatalog,
      )
      .map((entry) => ({
        url: entry.url,
        ...(entry.lastModified
          ? { lastModified: entry.lastModified }
          : {}),
      }));
    validateLocalEntries(selectedEntries);

    return {
      label:
        `${absolutePath}` +
        `${options.newOnly ? "（仅生产曲库未收录项）" : ""}`,
      sourceIdentifier:
        `local-index:${absolutePath}${options.newOnly ? "#new-only" : ""}`,
      entries: selectedEntries,
    };
  }

  console.log(`读取 Sitemap：${options.sitemapUrl}`);
  const sitemapXml = await fetchText(
    options.sitemapUrl,
    options.retries,
  );

  return {
    label: options.sitemapUrl,
    sourceIdentifier: options.sitemapUrl,
    entries: parseSitemapXml(sitemapXml),
  };
}

function validateLocalEntries(entries: SitemapEntry[]) {
  const validUrlPattern =
    /^https:\/\/www\.joysound\.com\/web\/search\/song\/\d+$/;
  const urls = entries.map((entry) => entry.url);

  if (urls.some((url) => !validUrlPattern.test(url))) {
    throw new Error("本地候选索引包含无效的 JOYSOUND 歌曲链接");
  }
  if (new Set(urls).size !== urls.length) {
    throw new Error("本地候选索引包含重复歌曲链接");
  }
}

function selectEntries<T>(entries: T[], options: CliOptions): T[] {
  return entries.slice(options.offset, options.offset + options.limit);
}

async function fetchText(url: string, retries: number): Promise<string> {
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    let response: Response;

    try {
      response = await fetch(url, {
        headers: {
          Accept: "text/html,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "ja,en;q=0.8",
          "User-Agent":
            "joysound-helper/0.3 (metadata crawler; respects robots and rate limits)",
        },
        signal: AbortSignal.timeout(20_000),
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

    const retryable = response.status === 429 || response.status >= 500;

    if (!retryable || attempt === retries) {
      throw new HttpStatusError(
        response.status,
        `${url} 返回 HTTP ${response.status}`,
      );
    }

    const retryAfterMs = readRetryAfterMs(response.headers.get("retry-after"));
    const backoffMs =
      retryAfterMs ??
      (response.status === 429
        ? 2 ** attempt * RATE_LIMIT_BACKOFF_MS
        : 2 ** attempt * 2_000);
    console.warn(
      `${url} 返回 HTTP ${response.status}，${backoffMs}ms 后重试`,
    );
    await sleep(backoffMs);
  }

  throw new Error(`无法获取 ${url}`);
}

function readRetryAfterMs(value: string | null): number | undefined {
  if (!value) {
    return undefined;
  }

  const seconds = Number(value);

  if (Number.isFinite(seconds)) {
    return Math.max(0, seconds * 1_000);
  }

  const date = Date.parse(value);
  return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now());
}

async function loadCheckpoint(
  path: string,
  sitemapUrl: string,
): Promise<Checkpoint> {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as Checkpoint;

    if (
      parsed.schemaVersion === SCHEMA_VERSION &&
      parsed.sitemapUrl === sitemapUrl
    ) {
      return parsed;
    }
  } catch {
    // 文件不存在或格式已过期时，从空检查点开始。
  }

  return {
    schemaVersion: SCHEMA_VERSION,
    sitemapUrl,
    updatedAt: new Date().toISOString(),
    items: {},
  };
}

async function saveCheckpoint(path: string, checkpoint: Checkpoint) {
  checkpoint.updatedAt = new Date().toISOString();
  await writeJsonAtomic(path, checkpoint);
}

async function writeJsonAtomic(path: string, value: unknown) {
  const absolutePath = resolve(path);
  const temporaryPath = `${absolutePath}.tmp`;

  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporaryPath, absolutePath);
}

function summarizeCheckpoint(checkpoint: Checkpoint) {
  const stats: Record<CrawlStatus, number> = {
    success: 0,
    "no-x1": 0,
    unavailable: 0,
    error: 0,
  };

  for (const item of Object.values(checkpoint.items)) {
    stats[item.status] += 1;
  }

  return stats;
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

function printHelp() {
  console.log(`JOYSOUND 元数据采集器

用法：
  bun run crawl:joysound -- [参数]

参数：
  --dry-run                         只读取 Sitemap，不请求歌曲页面
  --index-only                      将 Sitemap 候选项写入 JSON，不请求歌曲页面
  --input-index=PATH                从本地候选 JSON 读取歌曲链接
  --new-only                        仅使用本地索引中未进入生产曲库的歌曲
  --offset=N                        从第 N 个候选项开始，默认 0
  --limit=N                         最多处理 N 个页面，默认 ${DEFAULT_LIMIT}
  --delay-ms=N                      请求基础间隔，默认 ${DEFAULT_DELAY_MS}ms
  --jitter-ms=N                     随机附加间隔，默认 ${DEFAULT_JITTER_MS}ms
  --batch-size=N                    每批真实请求数，默认 ${DEFAULT_BATCH_SIZE}
  --batch-pause-min-ms=N            最短批次冷却，默认 ${DEFAULT_BATCH_PAUSE_MIN_MS}ms
  --batch-pause-max-ms=N            最长批次冷却，默认 ${DEFAULT_BATCH_PAUSE_MAX_MS}ms
  --batch-pause-ms=N                使用固定冷却时间，兼容旧命令
  --retries=N                       429/5xx 最大重试次数，默认 3
  --refresh                         忽略已有成功检查点
  --sitemap=URL                     指定官方 Sitemap
  --output=PATH                     指定生成 JSON 路径
  --checkpoint=PATH                 指定检查点路径
  --confirm-authorized-large-run    确认已获授权并允许超过 ${LARGE_RUN_THRESHOLD} 页
  --help                            显示帮助
`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
