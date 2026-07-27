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

  it("keeps only Han, kana, and Latin characters", () => {
    expect(
      normalizeSearchText(
        "「你好？！」☆カタカナ・ひらがな_English 2026 한글",
      ),
    ).toBe("你好かたかなひらがなenglish");
  });

  it("keeps kana long vowels and Japanese iteration marks", () => {
    expect(normalizeSearchText("テーゼ・時々")).toBe("てーぜ時々");
  });

  it("normalizes full-width and half-width katakana to hiragana", () => {
    expect(normalizeSearchText("カタカナ")).toBe("かたかな");
    expect(normalizeSearchText("ｶﾀｶﾅ")).toBe("かたかな");
    expect(normalizeSearchText("ヴァイオリン")).toBe(
      normalizeSearchText("ゔぁいおりん"),
    );
  });

  it("makes spaced romaji searchable as one value", () => {
    expect(normalizeSearchText("  yoru　ni kakeru  ")).toBe("yorunikakeru");
  });

  it("keeps Japanese and Chinese characters intact", () => {
    expect(normalizeSearchText("残酷な天使のテーゼ")).toBe(
      "残酷な天使のてーぜ",
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
