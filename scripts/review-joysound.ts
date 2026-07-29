import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import type { Song } from "../src/types";
import { parseJoysoundSongPage } from "./lib/joysound-parser";

const DEFAULT_INPUT_PATH = "src/data/generated/joysound-songs.json";
const DEFAULT_OUTPUT_PATH =
  "src/data/generated/joysound-review-sample.json";
const DEFAULT_SAMPLE_SIZE = 20;
const DELAY_MS = 5_000;
const JITTER_MS = 2_000;

type GeneratedSongs = {
  schemaVersion: number;
  songs: Song[];
};

type ReviewItem = {
  sourceUrl: string;
  title: string;
  artist: string;
  songNumbers: string[];
  matched: boolean;
  checkedAt: string;
  differences: string[];
};

type CliOptions = {
  inputPath: string;
  outputPath: string;
  sampleSize: number;
  help: boolean;
};

async function main() {
  const options = parseCliOptions(process.argv.slice(2));

  if (options.help) {
    printHelp();
    return;
  }

  const inputContent = await readFile(options.inputPath, "utf8");
  const input = JSON.parse(inputContent) as GeneratedSongs;

  if (
    input.schemaVersion !== 1 ||
    input.songs.length < options.sampleSize
  ) {
    throw new Error(
      `生成歌曲数据不足 ${options.sampleSize} 首或格式不受支持`,
    );
  }

  const selectedSongs = selectEvenly(input.songs, options.sampleSize);
  const reviewItems: ReviewItem[] = [];

  for (const [index, storedSong] of selectedSongs.entries()) {
    if (index > 0) {
      const delay =
        DELAY_MS + Math.floor(Math.random() * (JITTER_MS + 1));
      await sleep(delay);
    }

    console.log(
      `[${index + 1}/${selectedSongs.length}] 复核：${storedSong.sourceUrl}`,
    );
    const response = await fetch(storedSong.sourceUrl, {
      headers: {
        Accept: "text/html,*/*;q=0.8",
        "Accept-Language": "ja,en;q=0.8",
        "User-Agent":
          "joysound-helper/0.3 (authorized metadata review; rate limited)",
      },
      signal: AbortSignal.timeout(20_000),
    });

    if (!response.ok) {
      throw new Error(
        `${storedSong.sourceUrl} 返回 HTTP ${response.status}，已停止复核`,
      );
    }

    const liveSong = parseJoysoundSongPage(
      await response.text(),
      storedSong.sourceUrl,
    );
    const differences = compareSongs(storedSong, liveSong);

    reviewItems.push({
      sourceUrl: storedSong.sourceUrl,
      title: storedSong.title,
      artist: storedSong.artist,
      songNumbers: storedSong.variants
        .map((variant) => variant.songNumber)
        .sort(),
      matched: differences.length === 0,
      checkedAt: new Date().toISOString(),
      differences,
    });
  }

  const passed = reviewItems.every((item) => item.matched);
  const output = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    inputPath: options.inputPath,
    inputSha256: createHash("sha256")
      .update(inputContent)
      .digest("hex"),
    sampleMethod: "按生成曲库位置等距抽取",
    delayPolicy: {
      delayMs: DELAY_MS,
      jitterMs: JITTER_MS,
      concurrency: 1,
    },
    sampleSize: reviewItems.length,
    passed,
    samples: reviewItems,
  };

  await writeJsonAtomic(options.outputPath, output);
  console.log(
    `复核结果：${passed ? `${reviewItems.length}/${reviewItems.length} 通过` : "存在差异"}；` +
      `${resolve(options.outputPath)}`,
  );

  if (!passed) {
    process.exitCode = 1;
  }
}

function parseCliOptions(args: string[]): CliOptions {
  const options: CliOptions = {
    inputPath: DEFAULT_INPUT_PATH,
    outputPath: DEFAULT_OUTPUT_PATH,
    sampleSize: DEFAULT_SAMPLE_SIZE,
    help: false,
  };

  for (const argument of args) {
    if (argument === "--help" || argument === "-h") {
      options.help = true;
    } else if (argument.startsWith("--input=")) {
      options.inputPath = argument.slice("--input=".length);
    } else if (argument.startsWith("--output=")) {
      options.outputPath = argument.slice("--output=".length);
    } else if (argument.startsWith("--sample-size=")) {
      options.sampleSize = Number(
        argument.slice("--sample-size=".length),
      );
    } else {
      throw new Error(`未知参数：${argument}`);
    }
  }

  if (
    !Number.isSafeInteger(options.sampleSize) ||
    options.sampleSize < 2
  ) {
    throw new Error("sample-size 必须是至少为 2 的整数");
  }

  return options;
}

function selectEvenly<T>(items: T[], count: number): T[] {
  return Array.from({ length: count }, (_, index) => {
    const itemIndex = Math.round(
      (index * (items.length - 1)) / (count - 1),
    );
    return items[itemIndex]!;
  });
}

function compareSongs(storedSong: Song, liveSong: Song): string[] {
  const differences: string[] = [];

  if (storedSong.title !== liveSong.title) {
    differences.push(`歌名：${storedSong.title} ↔ ${liveSong.title}`);
  }
  if (storedSong.artist !== liveSong.artist) {
    differences.push(`歌手：${storedSong.artist} ↔ ${liveSong.artist}`);
  }

  const storedVariants = normalizeVariants(storedSong);
  const liveVariants = normalizeVariants(liveSong);

  if (JSON.stringify(storedVariants) !== JSON.stringify(liveVariants)) {
    differences.push("X1 版本名、类型或曲号发生变化");
  }

  return differences;
}

function normalizeVariants(song: Song) {
  return song.variants
    .map((variant) => ({
      songNumber: variant.songNumber,
      versionTitle: variant.versionTitle,
      versionType: variant.versionType,
      supportsX1: variant.supportsX1,
    }))
    .sort((first, second) =>
      first.songNumber.localeCompare(second.songNumber),
    );
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
  console.log(`JOYSOUND 歌曲来源抽样复核

用法：
  bun run review:joysound -- [参数]

参数：
  --input=PATH          生成歌曲数据，默认 ${DEFAULT_INPUT_PATH}
  --output=PATH         复核报告，默认 ${DEFAULT_OUTPUT_PATH}
  --sample-size=N       等距抽样数量，默认 ${DEFAULT_SAMPLE_SIZE}
  --help                显示帮助
`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
