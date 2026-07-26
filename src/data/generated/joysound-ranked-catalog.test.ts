import { describe, expect, it } from "vitest";

import catalog from "./joysound-ranked-catalog.json";

describe("joysound-ranked-catalog", () => {
  it("通过完整榜单白名单的采集与合并验收", () => {
    expect(catalog.crawlReady).toBe(true);
    expect(catalog.summary).toMatchObject({
      indexedCandidates: 812,
      processedCandidates: 812,
      pendingCandidates: 0,
      completionPercent: 100,
      successPages: 812,
      noX1Pages: 0,
      unavailablePages: 0,
      errorPages: 0,
      conflictCount: 0,
      generatedSongs: 812,
      generatedVariants: 2639,
      newSongs: 812,
      mergedSongs: 3185,
      mergedVariants: 5154,
    });
    expect(catalog.statusItems.pending).toEqual([]);
    expect(catalog.statusItems.error).toEqual([]);
    expect(catalog.conflicts).toEqual([]);
  });

  it("合并数据与摘要数量一致", () => {
    const variantCount = catalog.songs.reduce(
      (count, song) => count + song.variants.length,
      0,
    );

    expect(catalog.songs).toHaveLength(catalog.summary.mergedSongs);
    expect(variantCount).toBe(catalog.summary.mergedVariants);
  });
});
