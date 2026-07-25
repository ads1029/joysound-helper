import { describe, expect, it } from "vitest";

import { normalizeSearchText } from "./normalize";

describe("normalizeSearchText", () => {
  it("normalizes width, case, spaces, punctuation, and Japanese middle dots", () => {
    expect(normalizeSearchText(" ＡＢＣ・Ｄ! ")).toBe("abcd");
    expect(normalizeSearchText("God knows...")).toBe("godknows");
  });

  it("makes spaced romaji searchable as one value", () => {
    expect(normalizeSearchText("  yoru　ni kakeru  ")).toBe("yorunikakeru");
  });

  it("keeps Japanese and Chinese characters intact", () => {
    expect(normalizeSearchText("残酷な天使のテーゼ")).toBe(
      "残酷な天使のテーゼ",
    );
  });

  it("normalizes simplified, traditional, and Japanese kanji variants", () => {
    expect(normalizeSearchText("千本桜")).toBe(normalizeSearchText("千本樱"));
    expect(normalizeSearchText("千本桜")).toBe(normalizeSearchText("千本櫻"));
    expect(normalizeSearchText("夜に駆ける")).toBe(
      normalizeSearchText("夜に驱ける"),
    );
  });
});
