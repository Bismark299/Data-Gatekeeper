import { useMemo, useState } from "react";
import { useAdminGetReport } from "@workspace/api-client-react";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { AdminSidebar } from "@/components/AdminSidebar";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Menu, FileText, RefreshCw, Download, Loader2, TrendingUp } from "lucide-react";

// ─── helpers ──────────────────────────────────────────────────────────────────
function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function fmtReportDate(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  if (isNaN(d.getTime())) return iso;
  const month = d.toLocaleString("en-GH", { month: "short" });
  return `${ordinal(d.getDate())} ${month} ${d.getFullYear()}`;
}

const money = (n: number) => n.toLocaleString("en-GH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const num = (n: number) => n.toLocaleString("en-GH");

// ─── main export ──────────────────────────────────────────────────────────────
export default function AdminReport() {
  return (
    <ProtectedRoute adminOnly>
      <AdminReportContent />
    </ProtectedRoute>
  );
}

function AdminReportContent() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { toast } = useToast();
  const { data: rows, isLoading, refetch, isFetching } = useAdminGetReport();

  const report = rows ?? [];

  const totals = useMemo(() => {
    return report.reduce(
      (acc, r) => ({
        orders: acc.orders + r.orders,
        dataGb: acc.dataGb + r.dataGb,
        cost: acc.cost + r.cost,
        price: acc.price + r.price,
        profit: acc.profit + r.profit,
      }),
      { orders: 0, dataGb: 0, cost: 0, price: 0, profit: 0 },
    );
  }, [report]);

  const handleExport = () => {
    const headers = ["Order Date", "No. of Orders", "Data (GB)", "Cost", "Price", "Profit (GHS)"];
    const lines = report.map((r) => [
      fmtReportDate(r.date),
      r.orders,
      r.dataGb,
      r.cost.toFixed(2),
      r.price.toFixed(2),
      r.profit.toFixed(2),
    ]);
    const csv = [headers, ...lines].map((row) => row.join(",")).join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `report-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast({ title: `Exported ${report.length} day${report.length !== 1 ? "s" : ""}` });
  };

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      <AdminSidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      <div className="flex-1 min-w-0 flex flex-col overflow-y-auto">
        {/* ─── Header ─── */}
        <header className="sticky top-0 z-20 bg-background/95 backdrop-blur border-b border-border px-3 sm:px-6 py-4 flex items-center gap-3 flex-wrap">
          <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setSidebarOpen(true)}>
            <Menu className="w-5 h-5" />
          </Button>
          <div className="flex-1 flex items-center gap-2">
            <FileText className="w-5 h-5 text-primary" />
            <div>
              <h1 className="text-xl font-bold text-foreground">Report</h1>
              <p className="text-xs text-muted-foreground">
                Daily sales & profit from completed orders
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Button variant="outline" size="sm" onClick={() => refetch()} className="gap-1.5">
              <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? "animate-spin" : ""}`} /> Refresh
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleExport}
              disabled={report.length === 0}
              className="gap-1.5"
              data-testid="button-export-report"
            >
              <Download className="w-3.5 h-3.5" /> Export CSV
            </Button>
          </div>
        </header>

        <main className="flex-1 p-3 sm:p-6 space-y-4">
          {/* ─── Summary cards ─── */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <SummaryCard label="Total Orders" value={num(totals.orders)} />
            <SummaryCard label="Total Data" value={`${num(Math.round(totals.dataGb * 100) / 100)} GB`} />
            <SummaryCard label="Total Revenue" value={`GH₵ ${money(totals.price)}`} />
            <SummaryCard
              label="Total Profit"
              value={`GH₵ ${money(totals.profit)}`}
              accent
            />
          </div>

          {/* ─── Report table ─── */}
          <div className="bg-card border border-border rounded-2xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    <th className="text-left font-semibold px-5 py-3.5 whitespace-nowrap bg-gray-900 text-white">Order Date</th>
                    <th className="text-left font-semibold px-5 py-3.5 whitespace-nowrap bg-gray-900 text-white">No. of Orders</th>
                    <th className="text-left font-semibold px-5 py-3.5 whitespace-nowrap bg-gray-900 text-white">Data (GB)</th>
                    <th className="text-left font-semibold px-5 py-3.5 whitespace-nowrap bg-gray-900 text-white">Cost</th>
                    <th className="text-left font-semibold px-5 py-3.5 whitespace-nowrap bg-gray-900 text-white">Price</th>
                    <th className="text-left font-semibold px-5 py-3.5 whitespace-nowrap bg-blue-600 text-white">Profit (GHS)</th>
                  </tr>
                </thead>
                <tbody>
                  {isLoading ? (
                    <tr>
                      <td colSpan={6} className="px-5 py-16 text-center text-muted-foreground">
                        <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" />
                        Loading report…
                      </td>
                    </tr>
                  ) : report.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-5 py-16 text-center text-muted-foreground">
                        <FileText className="w-8 h-8 mx-auto mb-2 opacity-40" />
                        No completed orders yet.
                      </td>
                    </tr>
                  ) : (
                    report.map((r, i) => (
                      <tr
                        key={r.date}
                        className={`border-b border-border last:border-0 ${i % 2 === 1 ? "bg-muted/40" : ""}`}
                      >
                        <td className="px-5 py-3.5 whitespace-nowrap font-medium text-foreground">
                          {fmtReportDate(r.date)}
                        </td>
                        <td className="px-5 py-3.5 whitespace-nowrap text-foreground">{num(r.orders)}</td>
                        <td className="px-5 py-3.5 whitespace-nowrap text-foreground">{num(r.dataGb)}GB</td>
                        <td className="px-5 py-3.5 whitespace-nowrap text-foreground">{money(r.cost)}</td>
                        <td className="px-5 py-3.5 whitespace-nowrap text-foreground">{money(r.price)}</td>
                        <td className="px-5 py-3.5 whitespace-nowrap font-semibold text-blue-700 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/10">
                          {money(r.profit)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
                {report.length > 0 && (
                  <tfoot>
                    <tr className="border-t-2 border-border bg-muted/60 font-bold">
                      <td className="px-5 py-3.5 whitespace-nowrap text-foreground">Total</td>
                      <td className="px-5 py-3.5 whitespace-nowrap text-foreground">{num(totals.orders)}</td>
                      <td className="px-5 py-3.5 whitespace-nowrap text-foreground">
                        {num(Math.round(totals.dataGb * 100) / 100)}GB
                      </td>
                      <td className="px-5 py-3.5 whitespace-nowrap text-foreground">{money(totals.cost)}</td>
                      <td className="px-5 py-3.5 whitespace-nowrap text-foreground">{money(totals.price)}</td>
                      <td className="px-5 py-3.5 whitespace-nowrap text-blue-700 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/10">
                        {money(totals.profit)}
                      </td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}

function SummaryCard({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className={`rounded-2xl border p-4 ${accent ? "border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/10" : "border-border bg-card"}`}>
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
        {accent && <TrendingUp className="w-3.5 h-3.5 text-blue-600" />}
        {label}
      </div>
      <div className={`text-lg font-bold ${accent ? "text-blue-700 dark:text-blue-400" : "text-foreground"}`}>
        {value}
      </div>
    </div>
  );
}
