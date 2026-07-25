import { normalizeKanjiVariants } from "./kanji-variants";

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
