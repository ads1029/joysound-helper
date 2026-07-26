import { describe, expect, it } from "vitest";

import catalog from "./joysound-expanded-catalog.json";

describe("joysound-expanded-catalog", () => {
  it("通过热门歌手与平成榜扩展的完整验收", () => {
    expect(catalog.crawlReady).toBe(true);
    expect(catalog.summary).toMatchObject({
      indexedCandidates: 2435,
      processedCandidates: 2435,
      pendingCandidates: 0,
      completionPercent: 100,
      successPages: 2435,
      noX1Pages: 0,
      unavailablePages: 0,
      errorPages: 0,
      conflictCount: 0,
      productionSongs: 3185,
      productionVariants: 5154,
      generatedSongs: 2435,
      generatedVariants: 5607,
      newSongs: 2435,
      overlappingSongs: 0,
      addedVariants: 5607,
      mergedSongs: 5620,
      mergedVariants: 10761,
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
