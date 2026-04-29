import { useQuery } from "@tanstack/react-query";
import { TrendingUp, ArrowUpRight, CreditCard } from "lucide-react";

interface FinancialSummary {
  todayRevenue: number;
  todayProfit: number;
  allTimeRevenue: number;
  allTimeProfit: number;
  paystackBalance: number | null;
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
  colorClass,
  borderClass,
  bgClass,
  textClass,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
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
      </div>
    </div>
  );
}

export function AdminFinancialSummary() {
  const { data, isLoading } = useQuery({
    queryKey: ["admin-financial-summary"],
    queryFn: fetchFinancialSummary,
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  const fmt = (n: number) => `GH₵${n.toFixed(2)}`;

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
        colorClass="text-emerald-600 dark:text-emerald-400"
        borderClass="border-emerald-200 dark:border-emerald-800"
        bgClass="bg-emerald-50 dark:bg-emerald-950/30"
        textClass="text-emerald-700 dark:text-emerald-300"
      />
      <Pill
        icon={ArrowUpRight}
        label="Today's Profit"
        value={fmt(data.todayProfit)}
        colorClass="text-sky-600 dark:text-sky-400"
        borderClass="border-sky-200 dark:border-sky-800"
        bgClass="bg-sky-50 dark:bg-sky-950/30"
        textClass="text-sky-700 dark:text-sky-300"
      />
      {data.paystackBalance !== null ? (
        <Pill
          icon={CreditCard}
          label="Paystack Balance"
          value={fmt(data.paystackBalance)}
          colorClass="text-violet-600 dark:text-violet-400"
          borderClass="border-violet-200 dark:border-violet-800"
          bgClass="bg-violet-50 dark:bg-violet-950/30"
          textClass="text-violet-700 dark:text-violet-300"
        />
      ) : null}
    </div>
  );
}
