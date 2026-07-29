import { createHash } from "node:crypto";
import { resolve } from "node:path";

import type { Song } from "../../src/types";
import type { CatalogSnapshot } from "./joysound-catalog";
import { validateCrawlSongs } from "./joysound-parser";

export type GeneratedSongSnapshot = {
  schemaVersion: number;
  stats: {
    success: number;
    "no-x1": number;
    unavailable: number;
    error: number;
  };
  songs: Song[];
};

export type SourceReviewReport = {
  schemaVersion: number;
  generatedAt: string;
  inputPath: string;
  inputSha256?: string;
  sampleSize: number;
  passed: boolean;
  samples: Array<{
    sourceUrl: string;
    matched: boolean;
    differences: string[];
  }>;
};

export type ProductionCatalog = {
  schemaVersion: 1;
  generatedAt: string;
  productionReady: true;
  partialRelease: boolean;
  source: {
    catalogPath: string;
    catalogGeneratedAt: string;
    catalogSha256: string;
    generatedSongsPath: string;
    generatedSongsSha256: string;
    reviewPath: string;
    reviewGeneratedAt: string;
    reviewSha256: string;
  };
  summary: {
    indexedCandidates: number;
    processedCandidates: number;
    pendingCandidates: number;
    completionPercent: number;
    baseSongs: number;
    addedSongs: number;
    songs: number;
    variants: number;
    reviewedSamples: number;
  };
  songs: Song[];
};

type PromotionInput = {
  catalog: CatalogSnapshot;
  generatedSongs: GeneratedSongSnapshot;
  review: SourceReviewReport;
  catalogPath: string;
  catalogSha256: string;
  generatedSongsPath: string;
  generatedSongsSha256: string;
  reviewPath: string;
  reviewSha256: string;
  allowPartial: boolean;
  generatedAt?: string;
};

export function createProductionCatalog(
  input: PromotionInput,
): ProductionCatalog {
  validatePromotionInput(input);

  const { catalog, review } = input;

  return {
    schemaVersion: 1,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    productionReady: true,
    partialRelease: !catalog.crawlReady,
    source: {
      catalogPath: input.catalogPath,
      catalogGeneratedAt: catalog.generatedAt,
      catalogSha256: input.catalogSha256,
      generatedSongsPath: input.generatedSongsPath,
      generatedSongsSha256: input.generatedSongsSha256,
      reviewPath: input.reviewPath,
      reviewGeneratedAt: review.generatedAt,
      reviewSha256: input.reviewSha256,
    },
    summary: {
      indexedCandidates: catalog.summary.indexedCandidates,
      processedCandidates: catalog.summary.processedCandidates,
      pendingCandidates: catalog.summary.pendingCandidates,
      completionPercent: catalog.summary.completionPercent,
      baseSongs: catalog.summary.productionSongs,
      addedSongs: catalog.summary.newSongs,
      songs: catalog.summary.mergedSongs,
      variants: catalog.summary.mergedVariants,
      reviewedSamples: review.sampleSize,
    },
    songs: catalog.songs,
  };
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function validatePromotionInput(input: PromotionInput) {
  const { catalog, generatedSongs, review } = input;

  assert(catalog.schemaVersion === 1, "审计曲库格式不受支持");
  assert(generatedSongs.schemaVersion === 1, "生成歌曲格式不受支持");
  assert(review.schemaVersion === 1, "来源复核报告格式不受支持");

  assert(
    catalog.crawlReady || input.allowPartial,
    "采集尚未完整；如需发布干净的阶段性检查点，请显式使用 --allow-partial",
  );
  assert(catalog.summary.errorPages === 0, "审计曲库仍有请求错误");
  assert(catalog.summary.conflictCount === 0, "审计曲库仍有数据冲突");
  assert(catalog.statusItems.error.length === 0, "错误状态列表必须为空");
  assert(catalog.conflicts.length === 0, "冲突列表必须为空");
  assert(
    catalog.statusItems.outsideIndex.length === 0,
    "检查点包含候选索引之外的页面",
  );

  const processedCandidates =
    catalog.summary.successPages +
    catalog.summary.noX1Pages +
    catalog.summary.unavailablePages +
    catalog.summary.errorPages;

  assert(
    processedCandidates === catalog.summary.processedCandidates,
    "已处理候选统计不一致",
  );
  assert(
    processedCandidates + catalog.summary.pendingCandidates ===
      catalog.summary.indexedCandidates,
    "候选分母与处理状态不一致",
  );
  assert(
    catalog.statusItems.pending.length ===
      catalog.summary.pendingCandidates,
    "待处理候选列表与摘要不一致",
  );
  assert(
    catalog.songs.length === catalog.summary.mergedSongs,
    "合并歌曲数量与摘要不一致",
  );
  assert(
    countVariants(catalog.songs) === catalog.summary.mergedVariants,
    "合并版本数量与摘要不一致",
  );

  const songErrors = validateCrawlSongs(catalog.songs);

  assert(
    songErrors.length === 0,
    `生产歌曲未通过格式校验：${songErrors.join("；")}`,
  );

  assert(
    generatedSongs.stats.success === catalog.summary.successPages,
    "生成歌曲成功数与审计摘要不一致",
  );
  assert(
    generatedSongs.stats["no-x1"] === catalog.summary.noX1Pages,
    "生成歌曲无 X1 数与审计摘要不一致",
  );
  assert(
    generatedSongs.stats.unavailable === catalog.summary.unavailablePages,
    "生成歌曲不可用数与审计摘要不一致",
  );
  assert(
    generatedSongs.stats.error === catalog.summary.errorPages,
    "生成歌曲错误数与审计摘要不一致",
  );
  assert(
    generatedSongs.songs.length === catalog.summary.successPages,
    "生成歌曲列表长度与审计成功数不一致",
  );

  const generatedSourceUrls = generatedSongs.songs
    .map((song) => song.sourceUrl)
    .sort();
  const auditedSourceUrls = [...catalog.statusItems.success].sort();

  assert(
    JSON.stringify(generatedSourceUrls) ===
      JSON.stringify(auditedSourceUrls),
    "生成歌曲来源与审计成功页面不一致",
  );

  assert(review.passed, "来源复核未通过");
  assert(review.sampleSize >= 20, "来源复核样本不足 20 首");
  assert(
    review.samples.length === review.sampleSize,
    "来源复核样本数量与摘要不一致",
  );
  assert(
    review.samples.every(
      (sample) =>
        sample.matched &&
        sample.differences.length === 0 &&
        generatedSourceUrls.includes(sample.sourceUrl),
    ),
    "来源复核包含失败项或不属于当前生成歌曲的页面",
  );
  assert(
    new Set(review.samples.map((sample) => sample.sourceUrl)).size ===
      review.sampleSize,
    "来源复核样本包含重复页面",
  );
  assert(
    resolve(review.inputPath) === resolve(input.generatedSongsPath),
    "来源复核读取的歌曲文件与晋级输入不一致",
  );
  assert(
    review.inputSha256 === input.generatedSongsSha256,
    "生成歌曲内容已在来源复核后变化，请重新复核",
  );
}

function countVariants(songs: Song[]): number {
  return songs.reduce((count, song) => count + song.variants.length, 0);
}

function assert(
  condition: unknown,
  message: string,
): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}
