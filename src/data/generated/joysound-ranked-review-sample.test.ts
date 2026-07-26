import { describe, expect, it } from "vitest";

import review from "./joysound-ranked-review-sample.json";

describe("joysound-ranked-review-sample", () => {
  it("记录 20 首榜单歌曲的来源复核结果", () => {
    const sourceUrls = review.samples.map((sample) => sample.sourceUrl);

    expect(review.passed).toBe(true);
    expect(review.sampleSize).toBe(20);
    expect(review.samples).toHaveLength(20);
    expect(new Set(sourceUrls).size).toBe(20);

    for (const sample of review.samples) {
      expect(sample.matched).toBe(true);
      expect(sample.differences).toEqual([]);
      expect(sample.songNumbers.length).toBeGreaterThan(0);
    }
  });
});
