import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import review from "./joysound-full-artist-review-sample.json";

describe("joysound-full-artist-review-sample", () => {
  it("记录 20 首全曲目歌曲的来源复核结果和输入指纹", () => {
    const sourceUrls = review.samples.map((sample) => sample.sourceUrl);
    const inputContent = readFileSync(resolve(review.inputPath), "utf8");
    const inputSha256 = createHash("sha256")
      .update(inputContent)
      .digest("hex");

    expect(review.passed).toBe(true);
    expect(review.sampleSize).toBe(20);
    expect(review.samples).toHaveLength(20);
    expect(new Set(sourceUrls).size).toBe(20);
    expect(review.inputSha256).toBe(inputSha256);

    for (const sample of review.samples) {
      expect(sample.matched).toBe(true);
      expect(sample.differences).toEqual([]);
      expect(sample.songNumbers.length).toBeGreaterThan(0);
    }
  });
});
