import { describe, expect, it } from "vitest";

import { getPaginationItems } from "./pagination";

describe("getPaginationItems", () => {
  it("shows every page when the catalog is short", () => {
    expect(getPaginationItems(7, 4)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it("keeps the first pages and last page visible near the start", () => {
    expect(getPaginationItems(281, 1)).toEqual([
      1,
      2,
      3,
      4,
      5,
      "end-ellipsis",
      281,
    ]);
  });

  it("keeps neighboring pages visible in the middle", () => {
    expect(getPaginationItems(281, 140)).toEqual([
      1,
      "start-ellipsis",
      139,
      140,
      141,
      "end-ellipsis",
      281,
    ]);
  });

  it("keeps the first page and final pages visible near the end", () => {
    expect(getPaginationItems(281, 281)).toEqual([
      1,
      "start-ellipsis",
      277,
      278,
      279,
      280,
      281,
    ]);
  });

  it("clamps an out-of-range current page", () => {
    expect(getPaginationItems(10, 20)).toEqual([
      1,
      "start-ellipsis",
      6,
      7,
      8,
      9,
      10,
    ]);
  });
});
