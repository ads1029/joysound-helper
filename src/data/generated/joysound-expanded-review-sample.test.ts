import { describe, expect, it } from "vitest";

import review from "./joysound-expanded-review-sample.json";

describe("joysound-expanded-review-sample", () => {
  it("记录 20 首扩展歌曲的来源复核结果", () => {
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
