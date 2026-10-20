export type PaginationParams = {
  page: number;
  pageSize: number;
};

export function parsePagination(query: Record<string, unknown>): PaginationParams {
  const page = Math.max(1, Number(query.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(query.pageSize) || 20));
  return { page, pageSize };
}

export function toSkipTake({ page, pageSize }: PaginationParams) {
  return { skip: (page - 1) * pageSize, take: pageSize };
}

export function buildPageResult<T>(items: T[], total: number, params: PaginationParams) {
  return {
    items,
    total,
    page: params.page,
    pageSize: params.pageSize,
    totalPages: Math.max(1, Math.ceil(total / params.pageSize)),
  };
}
