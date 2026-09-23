type ExportOrder = {
  id: number;
  createdAt: string;
  status: string;
  delivered?: string | null;
  phoneNumber?: string;
  customerPhone?: string;
  bundleData?: string | null;
  price?: number | string;
  sellingPrice?: number | string;
  userName?: string | null;
  ownerName?: string | null;
  storeName?: string | null;
};

export async function fetchExportOrders(
  endpoint: string,
  filters: Record<string, string>,
): Promise<ExportOrder[]> {
  const orders: ExportOrder[] = [];
  for (let page = 1; ; page++) {
    const params = new URLSearchParams({ ...filters, page: String(page), pageSize: "200" });
    const response = await fetch(`${endpoint}?${params}`, { credentials: "include" });
    if (!response.ok) throw new Error("Could not load all orders for export. Please try again.");
    const result = await response.json();
    if (!Array.isArray(result.data) || !Number.isFinite(result.total)) {
      throw new Error("Invalid order export response");
    }
    orders.push(...result.data);
    if (orders.length >= result.total) return orders;
    if (!result.data.length) throw new Error("Order export was incomplete. Please try again.");
  }
}

export function buildAdminOrderExport(
  platform: ExportOrder[],
  store: ExportOrder[],
  options: {
    dateFrom: string;
    dateTo: string;
    phone: string;
    orderId: string;
    sortField: "date" | "id" | "amount";
    sortDir: "asc" | "desc";
    formatDate: (date: string) => string;
  },
) {
  const end = options.dateTo ? new Date(options.dateTo) : null;
  end?.setHours(23, 59, 59, 999);
  const rows = [
    ...platform.map(o => ({ ...o, source: "Platform", phone: o.phoneNumber ?? "", amount: Number(o.price), agent: o.userName ?? "", store: "" })),
    ...store.map(o => ({ ...o, source: "Store", phone: o.customerPhone ?? "", amount: Number(o.sellingPrice), agent: o.ownerName ?? "", store: o.storeName ?? "" })),
  ].filter(o =>
    (!options.dateFrom || new Date(o.createdAt) >= new Date(options.dateFrom)) &&
    (!end || new Date(o.createdAt) <= end) &&
    (!options.phone || o.phone.includes(options.phone)) &&
    (!options.orderId || String(o.id).includes(options.orderId)),
  ).sort((a, b) => {
    const diff = options.sortField === "amount" ? a.amount - b.amount
      : options.sortField === "id" ? a.id - b.id
      : new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    return options.sortDir === "asc" ? diff : -diff;
  });
  const esc = (value: unknown) => {
    const text = String(value ?? "");
    // Treat user-entered values as text, not spreadsheet formulas.
    return `"${(/^[=+\-@\t\r\n]/.test(text) ? "'" + text : text).replace(/"/g, '""')}"`;
  };
  const headers = ["Date", "Source", "Store", "Agent", "Order ID", "Phone", "Data", "Amount (GHS)", "Status", "Delivered"];
  return {
    count: rows.length,
    csv: [
      headers.map(esc).join(","),
      ...rows.map(o => [
        options.formatDate(o.createdAt), o.source, o.store, o.agent, o.id,
        o.phone, o.bundleData, o.amount.toFixed(2), o.status, o.delivered,
      ].map(esc).join(",")),
    ].join("\n"),
  };
}