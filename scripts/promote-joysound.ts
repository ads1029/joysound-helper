import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import type { CatalogSnapshot } from "./lib/joysound-catalog";
import {
  createProductionCatalog,
  sha256,
} from "./lib/joysound-promotion";
import type {
  GeneratedSongSnapshot,
  SourceReviewReport,
} from "./lib/joysound-promotion";

const DEFAULT_CATALOG_PATH =
  "src/data/generated/joysound-full-artist-catalog.json";
const DEFAULT_GENERATED_SONGS_PATH =
  "src/data/generated/joysound-full-artist-songs.json";
const DEFAULT_REVIEW_PATH =
  "src/data/generated/joysound-full-artist-review-sample.json";
const DEFAULT_OUTPUT_PATH =
  "src/data/generated/joysound-production-catalog.json";

type CliOptions = {
  catalogPath: string;
  generatedSongsPath: string;
  reviewPath: string;
  outputPath: string;
  allowPartial: boolean;
  help: boolean;
};

async function main() {
  const options = parseCliOptions(process.argv.slice(2));

  if (options.help) {
    printHelp();
    return;
  }

  const catalogContent = await readFile(options.catalogPath, "utf8");
  const generatedSongsContent = await readFile(
    options.generatedSongsPath,
    "utf8",
  );
  const reviewContent = await readFile(options.reviewPath, "utf8");
  const catalog = JSON.parse(catalogContent) as CatalogSnapshot;
  const generatedSongs = JSON.parse(
    generatedSongsContent,
  ) as GeneratedSongSnapshot;
  const review = JSON.parse(reviewContent) as SourceReviewReport;
  const productionCatalog = createProductionCatalog({
    catalog,
    generatedSongs,
    review,
    catalogPath: options.catalogPath,
    catalogSha256: sha256(catalogContent),
    generatedSongsPath: options.generatedSongsPath,
    generatedSongsSha256: sha256(generatedSongsContent),
    reviewPath: options.reviewPath,
    reviewSha256: sha256(reviewContent),
    allowPartial: options.allowPartial,
  });

  await writeJsonAtomic(options.outputPath, productionCatalog);

  console.log(`已生成生产曲库：${resolve(options.outputPath)}`);
  console.log(
    `发布结果：${productionCatalog.summary.songs} 首、` +
      `${productionCatalog.summary.variants} 个版本`,
  );
  console.log(
    `详情进度：${productionCatalog.summary.processedCandidates}/` +
      `${productionCatalog.summary.indexedCandidates}，` +
      `待处理 ${productionCatalog.summary.pendingCandidates}`,
  );
  console.log(
    `发布类型：${productionCatalog.partialRelease ? "阶段性检查点" : "完整轮次"}`,
  );
}

function parseCliOptions(args: string[]): CliOptions {
  const options: CliOptions = {
    catalogPath: DEFAULT_CATALOG_PATH,
    generatedSongsPath: DEFAULT_GENERATED_SONGS_PATH,
    reviewPath: DEFAULT_REVIEW_PATH,
    outputPath: DEFAULT_OUTPUT_PATH,
    allowPartial: false,
    help: false,
  };

  for (const argument of args) {
    if (argument === "--allow-partial") {
      options.allowPartial = true;
    } else if (argument === "--help" || argument === "-h") {
      options.help = true;
    } else if (argument.startsWith("--catalog=")) {
      options.catalogPath = argument.slice("--catalog=".length);
    } else if (argument.startsWith("--generated-songs=")) {
      options.generatedSongsPath = argument.slice(
        "--generated-songs=".length,
      );
    } else if (argument.startsWith("--review=")) {
      options.reviewPath = argument.slice("--review=".length);
    } else if (argument.startsWith("--output=")) {
      options.outputPath = argument.slice("--output=".length);
    } else {
      throw new Error(`未知参数：${argument}`);
    }
  }

  return options;
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

function printHelp() {
  console.log(`JOYSOUND 审计曲库生产晋级

用法：
  bun run promote:joysound -- [参数]

参数：
  --catalog=PATH          审计曲库，默认 ${DEFAULT_CATALOG_PATH}
  --generated-songs=PATH  复核对应的生成歌曲，默认 ${DEFAULT_GENERATED_SONGS_PATH}
  --review=PATH           来源复核报告，默认 ${DEFAULT_REVIEW_PATH}
  --output=PATH           精简生产曲库，默认 ${DEFAULT_OUTPUT_PATH}
  --allow-partial         明确允许发布无错误、无冲突的阶段性检查点
  --help                  显示帮助
`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
