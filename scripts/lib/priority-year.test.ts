import { describe, expect, it } from "vitest";

import { filterByMinimumYear } from "./priority-year";

describe("filterByMinimumYear", () => {
  it("保留边界年份并排除更早及未知年份", () => {
    expect(
      filterByMinimumYear(
        [
          { id: "old", year: 1999 },
          { id: "boundary", year: 2000 },
          { id: "new", year: 2026 },
          { id: "unknown" },
        ],
        2000,
      ),
    ).toEqual([
      { id: "boundary", year: 2000 },
      { id: "new", year: 2026 },
    ]);
  });

  it("未启用年份下限时保持候选原样", () => {
    const candidates = [{ id: "old", year: 1999 }, { id: "unknown" }];

    expect(filterByMinimumYear(candidates, undefined)).toBe(candidates);
  });
});
