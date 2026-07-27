import { normalizeKanjiVariants } from "./kanji-variants";

const KANJI_CHARACTER_PATTERN = /[\p{Script=Han}々]/u;
const SEARCH_CHARACTER_PATTERN =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Latin}々ー]/u;

function normalizeKanaVariant(character: string): string {
  const codePoint = character.codePointAt(0);

  if (
    codePoint !== undefined &&
    ((codePoint >= 0x30a1 && codePoint <= 0x30f6) ||
      (codePoint >= 0x30fd && codePoint <= 0x30fe))
  ) {
    return String.fromCodePoint(codePoint - 0x60);
  }

  return character;
}

export function normalizeSearchText(value: string): string {
  const normalized = Array.from(value.normalize("NFKC").toLocaleLowerCase())
    .filter((character) => SEARCH_CHARACTER_PATTERN.test(character))
    // 搜索内部统一使用平假名，使平假名、全角和半角片假名可互相匹配。
    .map(normalizeKanaVariant)
    .join("");

  return normalizeKanjiVariants(normalized);
}

export function normalizeKanjiOnlyText(value: string): string {
  return Array.from(normalizeSearchText(value))
    .filter((character) => KANJI_CHARACTER_PATTERN.test(character))
    .join("");
}
