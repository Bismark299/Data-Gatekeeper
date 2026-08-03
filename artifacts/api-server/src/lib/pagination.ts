// Shared server-side pagination helper.
//
// Contract (mirrors GET /admin/wallet-transactions): endpoints accept optional
// `page` + `pageSize` query params. When either is present (`wantsPage`), the
// endpoint returns a paginated envelope `{ total, page, pageSize, data }`
// (possibly with extra keys like `stats`). When absent, endpoints keep their
// legacy response shape with a bounded row cap so old callers never pull an
// unbounded table scan.
export function parsePage(
  query: Record<string, unknown>,
  opts: { defaultPageSize?: number; maxPageSize?: number } = {},
) {
  const wantsPage = query.page !== undefined || query.pageSize !== undefined;
  const page = Math.max(1, parseInt(String(query.page ?? "1")) || 1);
  const pageSize = Math.min(
    opts.maxPageSize ?? 200,
    Math.max(1, parseInt(String(query.pageSize ?? String(opts.defaultPageSize ?? 50))) || (opts.defaultPageSize ?? 50)),
  );
  return { wantsPage, page, pageSize, offset: (page - 1) * pageSize };
}

// Parse a YYYY-MM-DD (or ISO) date pair into [from, to] Dates, where `to` is
// pushed to end-of-day. Invalid strings are treated as absent.
export function parseDateRange(dateFrom?: string, dateTo?: string): { from: Date | null; to: Date | null } {
  let from: Date | null = null;
  let to: Date | null = null;
  if (dateFrom) {
    const f = new Date(dateFrom);
    if (!isNaN(f.getTime())) from = f;
  }
  if (dateTo) {
    const t = new Date(dateTo);
    if (!isNaN(t.getTime())) { t.setHours(23, 59, 59, 999); to = t; }
  }
  return { from, to };
}
