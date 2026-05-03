import { useQuery } from "@tanstack/react-query";
import { TrendingUp, ArrowUpRight, CreditCard, Store, ShoppingCart } from "lucide-react";

interface FinancialSummary {
  todayRevenue: number;
  todayProfit: number;
  allTimeRevenue: number;
  allTimeProfit: number;
  paystackBalance: number | null;
  todayRevenuePlatform: number;
  todayProfitPlatform: number;
  todayRevenueStore: number;
  todayProfitStore: number;
  allRevenuePlatform: number;
  allProfitPlatform: number;
  allRevenueStore: number;
  allProfitStore: number;
}

async function fetchFinancialSummary(): Promise<FinancialSummary> {
  const res = await fetch("/api/admin/financial-summary", { credentials: "include" });
  if (!res.ok) throw new Error("Failed to fetch financial summary");
  return res.json();
}

function Pill({
  icon: Icon,
  label,
  value,
  sub,
  colorClass,
  borderClass,
  bgClass,
  textClass,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  sub?: string;
  colorClass: string;
  borderClass: string;
  bgClass: string;
  textClass: string;
}) {
  return (
    <div className={`hidden lg:flex items-center gap-2 px-3 py-1.5 rounded-xl border ${borderClass} ${bgClass}`}>
      <Icon className={`w-3.5 h-3.5 ${colorClass} shrink-0`} />
      <div className="leading-none">
        <div className={`text-[9px] font-semibold uppercase tracking-wide ${colorClass} opacity-80`}>
          {label}
        </div>
        <div className={`text-sm font-extrabold ${textClass} leading-tight`}>
          {value}
        </div>
        {sub && (
          <div className={`text-[9px] ${colorClass} opacity-60 leading-tight mt-0.5`}>{sub}</div>
        )}
      </div>
    </div>
  );
}

export function AdminFinancialSummary() {
  const { data, isLoading } = useQuery({
    queryKey: ["admin-financial-summary"],
    queryFn: fetchFinancialSummary,
    refetchInterval: 5_000,
    staleTime: 0,
  });

  const fmt = (n: number | undefined | null) => `GH₵${(Number(n ?? 0)).toFixed(2)}`;

  if (isLoading || !data) {
    return (
      <div className="hidden lg:flex items-center gap-2">
        {[1, 2, 3].map(i => (
          <div key={i} className="h-10 w-28 rounded-xl bg-muted animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <div className="hidden lg:flex items-center gap-2">
      <Pill
        icon={TrendingUp}
        label="Today's Revenue"
        value={fmt(data.todayRevenue)}
        sub={`Direct: ${fmt(data.todayRevenuePlatform)} · Store: ${fmt(data.todayRevenueStore)}`}
        colorClass="text-emerald-600 dark:text-emerald-400"
        borderClass="border-emerald-200 dark:border-emerald-800"
        bgClass="bg-emerald-50 dark:bg-emerald-950/30"
        textClass="text-emerald-700 dark:text-emerald-300"
      />
      <Pill
        icon={ShoppingCart}
        label="Today's Profit (Direct)"
        value={fmt(data.todayProfitPlatform)}
        sub="From agent orders"
        colorClass="text-sky-600 dark:text-sky-400"
        borderClass="border-sky-200 dark:border-sky-800"
        bgClass="bg-sky-50 dark:bg-sky-950/30"
        textClass="text-sky-700 dark:text-sky-300"
      />
      <Pill
        icon={Store}
        label="Today's Profit (Store)"
        value={fmt(data.todayProfitStore)}
        sub="From store orders"
        colorClass="text-violet-600 dark:text-violet-400"
        borderClass="border-violet-200 dark:border-violet-800"
        bgClass="bg-violet-50 dark:bg-violet-950/30"
        textClass="text-violet-700 dark:text-violet-300"
      />
      <Pill
        icon={ArrowUpRight}
        label="Today's Profit (Total)"
        value={fmt(data.todayProfit)}
        sub={`Direct + Store`}
        colorClass="text-amber-600 dark:text-amber-400"
        borderClass="border-amber-200 dark:border-amber-800"
        bgClass="bg-amber-50 dark:bg-amber-950/30"
        textClass="text-amber-700 dark:text-amber-300"
      />
      {data.paystackBalance !== null ? (
        <Pill
          icon={CreditCard}
          label="Paystack Balance"
          value={fmt(data.paystackBalance)}
          colorClass="text-rose-600 dark:text-rose-400"
          borderClass="border-rose-200 dark:border-rose-800"
          bgClass="bg-rose-50 dark:bg-rose-950/30"
          textClass="text-rose-700 dark:text-rose-300"
        />
      ) : null}
    </div>
  );
}
