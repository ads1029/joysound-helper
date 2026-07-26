import { describe, expect, it } from "vitest";

import review from "./joysound-review-sample.json";

describe("joysound-review-sample", () => {
  it("记录至少 20 首均匀抽样的来源复核结果", () => {
    const sourceUrls = review.samples.map((sample) => sample.sourceUrl);

    expect(review.passed).toBe(true);
    expect(review.sampleSize).toBe(20);
    expect(review.samples).toHaveLength(review.sampleSize);
    expect(new Set(sourceUrls).size).toBe(review.sampleSize);
    expect(review.delayPolicy).toEqual({
      delayMs: 5000,
      jitterMs: 2000,
      concurrency: 1,
    });

    for (const sample of review.samples) {
      expect(sample.matched).toBe(true);
      expect(sample.differences).toEqual([]);
      expect(sample.songNumbers.length).toBeGreaterThan(0);
    }
  });
});
