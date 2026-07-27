import { describe, expect, it } from "vitest";

import catalog from "./joysound-full-artist-catalog.json";

describe("joysound-full-artist-catalog", () => {
  it("以完整全曲目候选索引作为详情审计分母", () => {
    expect(catalog.summary.indexedCandidates).toBe(18287);
    expect(
      catalog.summary.processedCandidates +
        catalog.summary.pendingCandidates,
    ).toBe(catalog.summary.indexedCandidates);
    expect(catalog.summary.processedCandidates).toBeGreaterThanOrEqual(
      20,
    );
    expect(catalog.summary.errorPages).toBe(0);
    expect(catalog.summary.conflictCount).toBe(0);
    expect(catalog.statusItems.error).toEqual([]);
    expect(catalog.conflicts).toEqual([]);
    expect(catalog.crawlReady).toBe(
      catalog.summary.pendingCandidates === 0,
    );
  });

  it("始终从 5,620 首生产基线合并当前成功详情", () => {
    const variantCount = catalog.songs.reduce(
      (count, song) => count + song.variants.length,
      0,
    );

    expect(catalog.summary.productionSongs).toBe(5620);
    expect(catalog.summary.productionVariants).toBe(10761);
    expect(catalog.summary.generatedSongs).toBe(
      catalog.summary.successPages,
    );
    expect(catalog.summary.newSongs).toBe(
      catalog.summary.generatedSongs,
    );
    expect(catalog.summary.overlappingSongs).toBe(0);
    expect(catalog.summary.mergedSongs).toBe(
      catalog.summary.productionSongs +
        catalog.summary.newSongs,
    );
    expect(catalog.songs).toHaveLength(
      catalog.summary.mergedSongs,
    );
    expect(variantCount).toBe(catalog.summary.mergedVariants);
  });
});
