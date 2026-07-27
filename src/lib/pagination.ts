export type PaginationItem =
  | number
  | "start-ellipsis"
  | "end-ellipsis";

export function getPaginationItems(
  totalPages: number,
  currentPage: number,
): PaginationItem[] {
  const lastPage = Math.max(1, Math.floor(totalPages));
  const activePage = Math.min(
    lastPage,
    Math.max(1, Math.floor(currentPage)),
  );

  if (lastPage <= 7) {
    return Array.from({ length: lastPage }, (_, index) => index + 1);
  }

  if (activePage <= 4) {
    return [1, 2, 3, 4, 5, "end-ellipsis", lastPage];
  }

  if (activePage >= lastPage - 3) {
    return [
      1,
      "start-ellipsis",
      lastPage - 4,
      lastPage - 3,
      lastPage - 2,
      lastPage - 1,
      lastPage,
    ];
  }

  return [
    1,
    "start-ellipsis",
    activePage - 1,
    activePage,
    activePage + 1,
    "end-ellipsis",
    lastPage,
  ];
}
