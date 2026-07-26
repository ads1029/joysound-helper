import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import popularCatalog from "../src/data/generated/joysound-popular-catalog.json";
import rankedCatalog from "../src/data/generated/joysound-ranked-catalog.json";
import { manualSongs } from "../src/data/manual-songs";
import type { Song } from "../src/types";
import type {
  CatalogSnapshot,
  CrawlCheckpoint,
} from "./lib/joysound-catalog";
import { createCatalogSnapshot } from "./lib/joysound-catalog";
import {
  parseSitemapXml,
  validateCrawlSongs,
} from "./lib/joysound-parser";

const DEFAULT_INDEX_PATH =
  "src/data/generated/joysound-popular-index.json";
const DEFAULT_CHECKPOINT_PATH =
  ".cache/joysound-crawler/checkpoint.json";
const DEFAULT_OUTPUT_PATH =
  "src/data/generated/joysound-popular-catalog.json";

type CandidateIndex = {
  schemaVersion: number;
  generatedAt?: string;
  sitemapUrl?: string;
  totalEntries?: number;
  entries: Array<{
    url: string;
    lastModified?: string;
    alreadyInProductionCatalog?: boolean;
  }>;
};

type AuditIndex = {
  schemaVersion: number;
  sitemapUrl: string;
  totalEntries: number;
  entries: Array<{
    url: string;
    lastModified?: string;
  }>;
};

type CliOptions = {
  indexPath: string;
  checkpointPath: string;
  outputPath: string;
  baseline: "manual" | "popular" | "ranked";
  newOnly: boolean;
  requireComplete: boolean;
  help: boolean;
};

async function main() {
  const options = parseCliOptions(process.argv.slice(2));

  if (options.help) {
    printHelp();
    return;
  }

  const candidateIndex = await readJson<CandidateIndex>(options.indexPath);
  const index = normalizeIndex(
    candidateIndex,
    options.indexPath,
    options.newOnly,
  );
  const checkpoint = await readJson<CrawlCheckpoint>(options.checkpointPath);
  validateInputs(index, checkpoint);

  const snapshot = createCatalogSnapshot(
    index,
    checkpoint,
    selectBaselineSongs(options.baseline),
  );
  const songErrors = validateCrawlSongs(snapshot.songs);

  if (songErrors.length > 0) {
    throw new Error(
      `合并曲库未通过校验：\n${songErrors.map((error) => `- ${error}`).join("\n")}`,
    );
  }

  await writeJsonAtomic(options.outputPath, snapshot);
  printSummary(snapshot, options.outputPath);

  if (options.requireComplete && !snapshot.crawlReady) {
    throw new Error(
      "采集尚未达到完整验收条件；请处理待采集页面、请求错误和数据冲突",
    );
  }
}

function selectBaselineSongs(
  baseline: CliOptions["baseline"],
): Song[] {
  if (baseline === "ranked") {
    return rankedCatalog.songs as Song[];
  }
  if (baseline === "popular") {
    return popularCatalog.songs as Song[];
  }
  return manualSongs;
}

function normalizeIndex(
  index: CandidateIndex,
  indexPath: string,
  newOnly: boolean,
): AuditIndex {
  if (index.schemaVersion !== 1 || !Array.isArray(index.entries)) {
    throw new Error("候选索引格式无效或版本不受支持");
  }

  if (typeof index.sitemapUrl === "string") {
    if (newOnly) {
      throw new Error("--new-only 只适用于本地榜单候选索引");
    }

    return {
      schemaVersion: index.schemaVersion,
      sitemapUrl: index.sitemapUrl,
      totalEntries: index.totalEntries ?? index.entries.length,
      entries: index.entries.map(({ url, lastModified }) => ({
        url,
        ...(lastModified ? { lastModified } : {}),
      })),
    };
  }

  const entries = index.entries
    .filter(
      (entry) =>
        !newOnly || entry.alreadyInProductionCatalog === false,
    )
    .map(({ url, lastModified }) => ({
      url,
      ...(lastModified ? { lastModified } : {}),
    }));

  return {
    schemaVersion: index.schemaVersion,
    sitemapUrl:
      `local-index:${resolve(indexPath)}` +
      `${newOnly ? "#new-only" : ""}`,
    totalEntries: entries.length,
    entries,
  };
}

function validateInputs(index: AuditIndex, checkpoint: CrawlCheckpoint) {
  if (
    index.schemaVersion !== 1 ||
    typeof index.sitemapUrl !== "string" ||
    !Array.isArray(index.entries)
  ) {
    throw new Error("候选索引格式无效或版本不受支持");
  }

  if (index.totalEntries !== index.entries.length) {
    throw new Error(
      `候选索引不完整：声明 ${index.totalEntries} 条，实际 ${index.entries.length} 条`,
    );
  }

  const parsedEntries = parseSitemapXml(
    `<urlset>${index.entries
      .map(
        (entry) =>
          `<url><loc>${escapeXml(entry.url)}</loc>` +
          `${entry.lastModified ? `<lastmod>${escapeXml(entry.lastModified)}</lastmod>` : ""}` +
          "</url>",
      )
      .join("")}</urlset>`,
  );

  if (parsedEntries.length !== index.entries.length) {
    throw new Error("候选索引包含无效的 JOYSOUND 歌曲链接");
  }

  const uniqueUrls = new Set(index.entries.map((entry) => entry.url));

  if (uniqueUrls.size !== index.entries.length) {
    throw new Error("候选索引包含重复歌曲链接");
  }

  if (
    checkpoint.schemaVersion !== 1 ||
    typeof checkpoint.items !== "object" ||
    checkpoint.items === null
  ) {
    throw new Error("检查点格式无效或版本不受支持");
  }

  if (checkpoint.sitemapUrl !== index.sitemapUrl) {
    throw new Error("候选索引与检查点来自不同 Sitemap");
  }
}

function parseCliOptions(args: string[]): CliOptions {
  const options: CliOptions = {
    indexPath: DEFAULT_INDEX_PATH,
    checkpointPath: DEFAULT_CHECKPOINT_PATH,
    outputPath: DEFAULT_OUTPUT_PATH,
    baseline: "manual",
    newOnly: false,
    requireComplete: false,
    help: false,
  };

  for (const argument of args) {
    if (argument === "--require-complete") {
      options.requireComplete = true;
    } else if (argument === "--new-only") {
      options.newOnly = true;
    } else if (argument === "--help" || argument === "-h") {
      options.help = true;
    } else if (argument.startsWith("--index=")) {
      options.indexPath = argument.slice("--index=".length);
    } else if (argument.startsWith("--checkpoint=")) {
      options.checkpointPath = argument.slice("--checkpoint=".length);
    } else if (argument.startsWith("--output=")) {
      options.outputPath = argument.slice("--output=".length);
    } else if (argument.startsWith("--baseline=")) {
      const baseline = argument.slice("--baseline=".length);

      if (
        baseline !== "manual" &&
        baseline !== "popular" &&
        baseline !== "ranked"
      ) {
        throw new Error(
          "baseline 必须是 manual、popular 或 ranked",
        );
      }
      options.baseline = baseline;
    } else {
      throw new Error(`未知参数：${argument}`);
    }
  }

  return options;
}

async function readJson<T>(path: string): Promise<T> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch (error) {
    throw new Error(
      `无法读取 JSON ${resolve(path)}：` +
        `${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

async function writeJsonAtomic(path: string, value: unknown) {
  const absolutePath = resolve(path);
  const temporaryPath = `${absolutePath}.tmp`;

  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporaryPath, absolutePath);
}

function printSummary(snapshot: CatalogSnapshot, outputPath: string) {
  const { summary } = snapshot;

  console.log(`已生成审计曲库：${resolve(outputPath)}`);
  console.log(
    `采集覆盖：${summary.processedCandidates}/${summary.indexedCandidates} ` +
      `(${summary.completionPercent}%)，待处理 ${summary.pendingCandidates}`,
  );
  console.log(
    `页面状态：成功 ${summary.successPages}，无 X1 ${summary.noX1Pages}，` +
      `不可用 ${summary.unavailablePages}，错误 ${summary.errorPages}`,
  );
  console.log(
    `合并结果：${summary.mergedSongs} 首、${summary.mergedVariants} 个版本，` +
      `新增 ${summary.newSongs} 首，冲突 ${summary.conflictCount} 项`,
  );
  console.log(`采集验收：${snapshot.crawlReady ? "通过" : "未完成"}`);
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&apos;");
}

function printHelp() {
  console.log(`JOYSOUND 曲库合并与覆盖率审计

用法：
  bun run audit:joysound -- [参数]

参数：
  --index=PATH          候选索引，默认 ${DEFAULT_INDEX_PATH}
  --checkpoint=PATH     采集检查点，默认 ${DEFAULT_CHECKPOINT_PATH}
  --output=PATH         合并曲库与报告，默认 ${DEFAULT_OUTPUT_PATH}
  --new-only            审计本地榜单索引中尚未进入生产曲库的页面
  --baseline=TYPE       合并基线：manual（默认）、popular 或 ranked
  --require-complete    有待处理、错误或冲突时以失败状态退出
  --help                显示帮助
`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
