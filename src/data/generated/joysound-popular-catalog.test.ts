import { describe, expect, it } from "vitest";

import catalog from "./joysound-popular-catalog.json";

describe("joysound-popular-catalog", () => {
  it("通过完整热门候选的采集验收", () => {
    expect(catalog.crawlReady).toBe(true);
    expect(catalog.summary).toMatchObject({
      indexedCandidates: 2355,
      processedCandidates: 2355,
      pendingCandidates: 0,
      completionPercent: 100,
      successPages: 2353,
      noX1Pages: 0,
      unavailablePages: 2,
      errorPages: 0,
      conflictCount: 0,
      mergedSongs: 2373,
      mergedVariants: 2515,
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
