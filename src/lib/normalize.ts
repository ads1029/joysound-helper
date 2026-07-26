import { normalizeKanjiVariants } from "./kanji-variants";

const KANJI_CHARACTER_PATTERN = /[\p{Script=Han}々]/u;

export function normalizeSearchText(value: string): string {
  const normalized = value
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[・･]/g, "")
    .replace(/[\s\u3000]+/g, "")
    .replace(/[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~]/g, "")
    .trim();

  return normalizeKanjiVariants(normalized);
}

export function normalizeKanjiOnlyText(value: string): string {
  return Array.from(normalizeSearchText(value))
    .filter((character) => KANJI_CHARACTER_PATTERN.test(character))
    .join("");
}
