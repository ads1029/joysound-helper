import { normalizeKanjiVariants } from "./kanji-variants";

const KANJI_CHARACTER_PATTERN = /[\p{Script=Han}々]/u;
const SEARCH_CHARACTER_PATTERN =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Latin}々ー]/u;

export function normalizeSearchText(value: string): string {
  const normalized = Array.from(value.normalize("NFKC").toLocaleLowerCase())
    .filter((character) => SEARCH_CHARACTER_PATTERN.test(character))
    .join("");

  return normalizeKanjiVariants(normalized);
}

export function normalizeKanjiOnlyText(value: string): string {
  return Array.from(normalizeSearchText(value))
    .filter((character) => KANJI_CHARACTER_PATTERN.test(character))
    .join("");
}
