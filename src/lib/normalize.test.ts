import { describe, expect, it } from "vitest";

import {
  normalizeKanjiOnlyText,
  normalizeSearchText,
} from "./normalize";

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

  it("keeps only normalized kanji for kanji-only searches", () => {
    expect(normalizeKanjiOnlyText("残酷な天使のテーゼ")).toBe("残酷天使");
    expect(normalizeKanjiOnlyText("夜に驱ける")).toBe("夜駆");
    expect(normalizeKanjiOnlyText("時々（ライブ版）")).toBe("時々版");
  });
});
