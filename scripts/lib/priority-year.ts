export type YearBoundCandidate = {
  year?: number;
};

/** 严格年份模式不接受缺少年份的候选，避免未知年份混入有明确下限的批次。 */
export function filterByMinimumYear<T extends YearBoundCandidate>(
  candidates: T[],
  minimumYear: number | undefined,
): T[] {
  if (minimumYear === undefined) {
    return candidates;
  }

  return candidates.filter(
    (candidate) =>
      candidate.year !== undefined && candidate.year >= minimumYear,
  );
}
