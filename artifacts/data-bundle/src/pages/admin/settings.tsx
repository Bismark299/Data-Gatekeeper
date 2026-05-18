import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { AdminSidebar } from "@/components/AdminSidebar";
import { AdminFinancialSummary } from "@/components/AdminFinancialSummary";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import {
  Menu, Settings, Save, RefreshCw, Globe, CreditCard, Phone,
  Mail, Shield, Info, CheckCircle2, AlertCircle, Building2,
  Zap, Wifi, Loader2, Package2,
} from "lucide-react";

export default function AdminSettings() {
  return (
    <ProtectedRoute adminOnly>
      <AdminSettingsContent />
    </ProtectedRoute>
  );
}

const DEFAULTS: Record<string, string> = {
  platform_name:       "DataBundle GH",
  platform_tagline:    "Fast & Reliable Data Bundles in Ghana",
  support_email:       "support@databundle.com",
  support_phone:       "0500000000",
  support_whatsapp:    "0500000000",
  currency:            "GHS",
  momo_number:         "",
  momo_name:           "",
  min_deposit:         "5",
  max_deposit:         "5000",
  min_wallet_balance:  "0",
  paystack_status:     "live",
  maintenance_mode:    "false",
  registration_open:   "true",
  store_enabled:       "true",
  order_auto_complete: "false",
  footer_note:         "© 2025 DataBundle GH. All rights reserved.",
  mcbis_enabled:               "false",
  topupgh_enabled:             "false",
  topupgh_min_batch:           "5",
  topupgh_max_batch:           "50",
  network_mtn_enabled:         "true",
  network_telecel_enabled:     "true",
  "network_at-ishare_enabled": "true",
  "network_at-bigtime_enabled": "true",
};

type Section = {
  key: string;
  icon: React.ElementType;
  title: string;
  description: string;
  fields: { key: string; label: string; type?: string; hint?: string; options?: string[] }[];
};

const SECTIONS: Section[] = [
  {
    key: "platform",
    icon: Building2,
    title: "Platform Info",
    description: "Basic platform branding and identity",
    fields: [
      { key: "platform_name",    label: "Platform Name",   hint: "Displayed in the header and emails" },
      { key: "platform_tagline", label: "Tagline / Slogan", hint: "Short description of your platform" },
      { key: "footer_note",      label: "Footer Text",      hint: "Copyright notice or disclaimer shown at bottom" },
    ],
  },
  {
    key: "support",
    icon: Phone,
    title: "Support & Contact",
    description: "Contact details shown to users",
    fields: [
      { key: "support_email",    label: "Support Email",    type: "email" },
      { key: "support_phone",    label: "Support Phone",    hint: "e.g. 0244123456" },
      { key: "support_whatsapp", label: "WhatsApp Number",  hint: "e.g. 0244123456" },
    ],
  },
  {
    key: "payments",
    icon: CreditCard,
    title: "Payment Settings",
    description: "Deposit limits and payment configuration",
    fields: [
      { key: "momo_number", label: "MoMo Deposit Number", hint: "Phone number agents/users send money to (e.g. 0244123456)" },
      { key: "momo_name",   label: "MoMo Account Name",  hint: "Name shown on the deposit instructions" },
      { key: "currency",           label: "Currency",        hint: "ISO currency code (e.g. GHS)" },
      { key: "min_deposit",        label: "Min Deposit (GH₵)", type: "number" },
      { key: "max_deposit",        label: "Max Deposit (GH₵)", type: "number" },
      { key: "paystack_status",    label: "Paystack Mode",   options: ["live", "test"], hint: "live = production keys, test = sandbox keys" },
    ],
  },
  {
    key: "features",
    icon: Globe,
    title: "Feature Flags",
    description: "Enable or disable platform features",
    fields: [
      { key: "maintenance_mode",    label: "Maintenance Mode",     options: ["false", "true"],  hint: "When true, users see a maintenance page" },
      { key: "registration_open",   label: "Allow Registration",   options: ["true", "false"],  hint: "Whether new users can sign up" },
      { key: "store_enabled",       label: "Agent Stores",         options: ["true", "false"],  hint: "Enable the Agent Store System" },
      { key: "order_auto_complete", label: "Auto-Complete Orders", options: ["false", "true"],  hint: "Auto-complete orders on creation (skip manual)" },
    ],
  },
];

function SettingField({
  field,
  value,
  onChange,
}: {
  field: Section["fields"][number];
  value: string;
  onChange: (v: string) => void;
}) {
  if (field.options) {
    return (
      <div className="space-y-1">
        <Label className="text-xs font-semibold text-foreground">{field.label}</Label>
        <div className="flex gap-2 flex-wrap">
          {field.options.map(opt => (
            <button
              key={opt}
              type="button"
              onClick={() => onChange(opt)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors capitalize ${
                value === opt
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-card text-muted-foreground border-border hover:border-primary/40"
              }`}
            >
              {opt}
            </button>
          ))}
        </div>
        {field.hint && <p className="text-[11px] text-muted-foreground mt-1">{field.hint}</p>}
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <Label htmlFor={field.key} className="text-xs font-semibold text-foreground">{field.label}</Label>
      <Input
        id={field.key}
        type={field.type ?? "text"}
        value={value}
        onChange={e => onChange(e.target.value)}
        className="h-8 text-sm"
        placeholder={DEFAULTS[field.key] ?? ""}
      />
      {field.hint && <p className="text-[11px] text-muted-foreground">{field.hint}</p>}
    </div>
  );
}

const NETWORK_CONFIG = [
  { key: "network_mtn_enabled",         label: "MTN",      dot: "bg-yellow-400", badge: "MTN" },
  { key: "network_telecel_enabled",     label: "Telecel",  dot: "bg-red-500",    badge: "Telecel" },
  { key: "network_at-ishare_enabled",   label: "AT iShare",dot: "bg-blue-500",   badge: "AT iShare" },
  { key: "network_at-bigtime_enabled",  label: "AT BigTime",dot: "bg-green-500", badge: "AT BigTime" },
] as const;

function NetworkSettingsSection({
  local,
  onToggle,
}: {
  local: Record<string, string>;
  onToggle: (key: string, enabled: boolean) => void;
}) {
  return (
    <div className="bg-card border border-border rounded-2xl p-5 space-y-5">
      {/* Header */}
      <div className="flex items-start gap-3 pb-4 border-b border-border">
        <div className="w-8 h-8 rounded-lg bg-blue-500/10 flex items-center justify-center shrink-0">
          <Wifi className="w-4 h-4 text-blue-500" />
        </div>
        <div className="flex-1">
          <h2 className="font-semibold text-foreground text-sm">Network Settings</h2>
          <p className="text-xs text-muted-foreground">Enable or disable networks across the platform. Disabled networks are hidden from agents and the public store.</p>
        </div>
      </div>

      <div className="space-y-3">
        {NETWORK_CONFIG.map(({ key, label, dot }) => {
          const enabled = (local[key] ?? "true") !== "false";
          return (
            <div key={key} className="flex items-center justify-between bg-muted/30 rounded-xl px-4 py-3">
              <div className="flex items-center gap-3">
                <div className={`w-2.5 h-2.5 rounded-full ${dot}`} />
                <div>
                  <div className="text-sm font-semibold text-foreground">{label}</div>
                  <div className="text-xs text-muted-foreground">{enabled ? "Visible to agents and customers" : "Hidden from agents and customers"}</div>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                  enabled ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400" : "bg-muted text-muted-foreground"
                }`}>
                  {enabled ? "ON" : "OFF"}
                </span>
                <button
                  type="button"
                  onClick={() => onToggle(key, !enabled)}
                  className={`relative w-11 h-6 rounded-full transition-colors focus:outline-none ${
                    enabled ? "bg-emerald-500" : "bg-muted-foreground/30"
                  }`}
                  aria-label={`Toggle ${label}`}
                >
                  <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${
                    enabled ? "translate-x-5" : "translate-x-0"
                  }`} />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TopUpGHSection({
  enabled,
  mcbisEnabled,
  minBatch,
  maxBatch,
  onToggle,
  onBatchChange,
}: {
  enabled: boolean;
  mcbisEnabled: boolean;
  minBatch: string;
  maxBatch: string;
  onToggle: (v: boolean) => void;
  onBatchChange: (key: string, val: string) => void;
}) {
  const [balanceState, setBalanceState] = useState<"idle" | "loading" | "ok" | "error">("idle");
  const [balance, setBalance] = useState<number | null>(null);
  const { toast } = useToast();

  const checkBalance = async () => {
    setBalanceState("loading");
    try {
      const res = await fetch("/api/admin/topupgh/balance", { credentials: "include" });
      const data = await res.json() as { balance?: number; success?: boolean; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Failed");
      setBalance(data.balance ?? null);
      setBalanceState("ok");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Failed to fetch balance";
      toast({ title: msg, variant: "destructive" });
      setBalanceState("error");
    }
  };

  return (
    <div className="bg-card border border-border rounded-2xl p-5 space-y-5">
      {/* Header */}
      <div className="flex items-start gap-3 pb-4 border-b border-border">
        <div className="w-8 h-8 rounded-lg bg-orange-500/10 flex items-center justify-center shrink-0">
          <Package2 className="w-4 h-4 text-orange-500" />
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h2 className="font-semibold text-foreground text-sm">TopUpGH Batch Fulfillment</h2>
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${enabled ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400" : "bg-muted text-muted-foreground"}`}>
              {enabled ? "ENABLED" : "DISABLED"}
            </span>
          </div>
          <p className="text-xs text-muted-foreground">Batch MTN orders and dispatch via TopUpGH Reseller API (min. 5 orders per batch)</p>
        </div>
      </div>

      {/* Mutual exclusivity notice */}
      {mcbisEnabled && (
        <div className="flex items-start gap-2 px-3 py-2 rounded-xl bg-purple-50 dark:bg-purple-900/10 border border-purple-200 dark:border-purple-800">
          <Info className="w-3.5 h-3.5 text-purple-500 shrink-0 mt-0.5" />
          <p className="text-[11px] text-purple-700 dark:text-purple-400">
            <strong>McbisSolution is currently active.</strong> Enabling TopUpGH will automatically disable McbisSolution. Both providers cannot run simultaneously.
          </p>
        </div>
      )}

      {/* Toggle row */}
      <div className="flex items-center justify-between bg-muted/30 rounded-xl px-4 py-3">
        <div>
          <div className="text-sm font-semibold text-foreground">Enable Batch Fulfillment</div>
          <div className="text-xs text-muted-foreground">MTN orders are queued and dispatched in batches to TopUpGH</div>
        </div>
        <button
          type="button"
          onClick={() => onToggle(!enabled)}
          className={`relative w-11 h-6 rounded-full transition-colors focus:outline-none ${enabled ? "bg-emerald-500" : "bg-muted-foreground/30"}`}
          aria-label="Toggle TopUpGH"
        >
          <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${enabled ? "translate-x-5" : "translate-x-0"}`} />
        </button>
      </div>

      {/* Batch size settings */}
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1">
          <Label htmlFor="topupgh_min_batch" className="text-xs font-semibold text-foreground">Min Batch Size</Label>
          <Input
            id="topupgh_min_batch"
            type="number"
            min={5}
            max={100}
            value={minBatch}
            onChange={e => onBatchChange("topupgh_min_batch", e.target.value)}
            className="h-8 text-sm"
          />
          <p className="text-[11px] text-muted-foreground">Minimum 5 (TopUpGH API limit)</p>
        </div>
        <div className="space-y-1">
          <Label htmlFor="topupgh_max_batch" className="text-xs font-semibold text-foreground">Max Batch Size</Label>
          <Input
            id="topupgh_max_batch"
            type="number"
            min={5}
            max={100}
            value={maxBatch}
            onChange={e => onBatchChange("topupgh_max_batch", e.target.value)}
            className="h-8 text-sm"
          />
          <p className="text-[11px] text-muted-foreground">Maximum 100 (TopUpGH API limit)</p>
        </div>
      </div>

      {/* Network coverage + balance */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <Wifi className="w-3.5 h-3.5 text-yellow-500" />
          <span className="text-xs text-muted-foreground">Coverage: <span className="font-semibold text-foreground">MTN only</span></span>
          <span className="text-[10px] bg-yellow-100 text-yellow-700 dark:bg-yellow-900/20 dark:text-yellow-400 px-2 py-0.5 rounded-full font-medium">Telecel &amp; AT not supported</span>
        </div>
        <div className="flex items-center gap-2">
          {balanceState === "ok" && balance !== null && (
            <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">
              Wallet: GH₵{balance.toFixed(2)}
            </span>
          )}
          <Button type="button" variant="outline" size="sm" onClick={checkBalance} disabled={balanceState === "loading"} className="gap-1.5 h-7 text-xs">
            {balanceState === "loading" ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
            Check Balance
          </Button>
        </div>
      </div>

      {/* Credential hint */}
      <div className="flex items-start gap-2.5 px-3.5 py-2.5 rounded-xl bg-orange-50 dark:bg-orange-900/10 border border-orange-200 dark:border-orange-800">
        <Info className="w-3.5 h-3.5 text-orange-500 shrink-0 mt-0.5" />
        <p className="text-[11px] text-orange-700 dark:text-orange-400">
          Requires <strong>TOPUPGH_API_KEY</strong> and <strong>TOPUPGH_API_SECRET</strong> environment variables plus domain whitelist in your TopUpGH dashboard.
          Pending MTN orders are auto-dispatched every <strong>2 minutes</strong> when the queue reaches the minimum batch size.
        </p>
      </div>
    </div>
  );
}

function McbisSolutionSection({
  enabled,
  topupghEnabled,
  onToggle,
}: {
  enabled: boolean;
  topupghEnabled: boolean;
  onToggle: (v: boolean) => void;
}) {
  const [balanceState, setBalanceState] = useState<"idle" | "loading" | "ok" | "error">("idle");
  const [balance, setBalance] = useState<number | null>(null);
  const { toast } = useToast();

  const checkBalance = async () => {
    setBalanceState("loading");
    try {
      const res = await fetch("/api/admin/mcbis/balance", { credentials: "include" });
      const data = await res.json() as { balance?: number; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Failed");
      setBalance(data.balance ?? null);
      setBalanceState("ok");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Failed to fetch balance";
      toast({ title: msg, variant: "destructive" });
      setBalanceState("error");
    }
  };

  return (
    <div className="bg-card border border-border rounded-2xl p-5 space-y-5">
      {/* Header */}
      <div className="flex items-start gap-3 pb-4 border-b border-border">
        <div className="w-8 h-8 rounded-lg bg-purple-500/10 flex items-center justify-center shrink-0">
          <Zap className="w-4 h-4 text-purple-500" />
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h2 className="font-semibold text-foreground text-sm">McbisSolution Auto-Fulfillment</h2>
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${enabled ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400" : "bg-muted text-muted-foreground"}`}>
              {enabled ? "ENABLED" : "DISABLED"}
            </span>
          </div>
          <p className="text-xs text-muted-foreground">Automatically send MTN orders to McbisSolution for instant fulfillment</p>
        </div>
      </div>

      {/* Mutual exclusivity notice */}
      {topupghEnabled && (
        <div className="flex items-start gap-2 px-3 py-2 rounded-xl bg-orange-50 dark:bg-orange-900/10 border border-orange-200 dark:border-orange-800">
          <Info className="w-3.5 h-3.5 text-orange-500 shrink-0 mt-0.5" />
          <p className="text-[11px] text-orange-700 dark:text-orange-400">
            <strong>TopUpGH is currently active.</strong> Enabling McbisSolution will automatically disable TopUpGH. Both providers cannot run simultaneously.
          </p>
        </div>
      )}

      {/* Toggle row */}
      <div className="flex items-center justify-between bg-muted/30 rounded-xl px-4 py-3">
        <div>
          <div className="text-sm font-semibold text-foreground">Enable Auto-Fulfillment</div>
          <div className="text-xs text-muted-foreground">MTN orders are sent to McbisSolution immediately after payment</div>
        </div>
        <button
          type="button"
          onClick={() => onToggle(!enabled)}
          className={`relative w-11 h-6 rounded-full transition-colors focus:outline-none ${enabled ? "bg-emerald-500" : "bg-muted-foreground/30"}`}
          aria-label="Toggle McbisSolution"
        >
          <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${enabled ? "translate-x-5" : "translate-x-0"}`} />
        </button>
      </div>

      {/* Network coverage + balance */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <Wifi className="w-3.5 h-3.5 text-yellow-500" />
          <span className="text-xs text-muted-foreground">Coverage: <span className="font-semibold text-foreground">MTN only</span></span>
          <span className="text-[10px] bg-yellow-100 text-yellow-700 dark:bg-yellow-900/20 dark:text-yellow-400 px-2 py-0.5 rounded-full font-medium">Telecel &amp; AT coming soon</span>
        </div>
        <div className="flex items-center gap-2">
          {balanceState === "ok" && balance !== null && (
            <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">
              Wallet: GH₵{balance.toFixed(2)}
            </span>
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={checkBalance}
            disabled={balanceState === "loading"}
            className="gap-1.5 h-7 text-xs"
          >
            {balanceState === "loading"
              ? <Loader2 className="w-3 h-3 animate-spin" />
              : <RefreshCw className="w-3 h-3" />}
            Check Balance
          </Button>
        </div>
      </div>

      {/* Info */}
      <div className="flex items-start gap-2.5 px-3.5 py-2.5 rounded-xl bg-purple-50 dark:bg-purple-900/10 border border-purple-200 dark:border-purple-800">
        <Info className="w-3.5 h-3.5 text-purple-500 shrink-0 mt-0.5" />
        <p className="text-[11px] text-purple-700 dark:text-purple-400">
          When enabled, new MTN orders are auto-dispatched to McbisSolution after purchase/payment confirmation.
          Orders that succeed immediately are marked <strong>completed</strong>; pending ones become <strong>processing</strong>.
          Non-MTN orders and failed dispatches are not affected — admin handles them manually.
        </p>
      </div>
    </div>
  );
}

function AdminSettingsContent() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [local, setLocal] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: settings, isLoading, refetch } = useQuery<Record<string, string>>({
    queryKey: ["adminSettings"],
    queryFn: () => fetch("/api/admin/settings", { credentials: "include" }).then(r => r.json()),
  });

  useEffect(() => {
    if (settings) {
      const merged = { ...DEFAULTS, ...settings };
      setLocal(merged);
      setDirty(false);
    }
  }, [settings]);

  const saveMutation = useMutation({
    mutationFn: async (data: Record<string, string>) => {
      const r = await fetch("/api/admin/settings", {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      const json = await r.json() as Record<string, string>;
      if (!r.ok) throw new Error((json as { error?: string }).error ?? "Failed to save");
      return json;
    },
    onSuccess: (saved: Record<string, string>) => {
      queryClient.setQueryData(["adminSettings"], saved);
      toast({ title: "Settings saved successfully" });
      setDirty(false);
    },
    onError: (e: unknown) => toast({ title: e instanceof Error ? e.message : "Failed to save settings", variant: "destructive" }),
  });

  const handleChange = (key: string, value: string) => {
    setLocal(prev => ({ ...prev, [key]: value }));
    setDirty(true);
  };

  const handleSave = () => saveMutation.mutate(local);

  const handleReset = () => {
    if (settings) { setLocal({ ...DEFAULTS, ...settings }); setDirty(false); }
  };

  const paystackKeySet = !!(import.meta.env.VITE_PAYSTACK_KEY || true);

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      <AdminSidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      <div className="flex-1 flex flex-col overflow-auto">
        {/* Header */}
        <header className="sticky top-0 z-20 bg-background/95 backdrop-blur border-b border-border px-6 py-4 flex items-center gap-3 flex-wrap">
          <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setSidebarOpen(true)}>
            <Menu className="w-5 h-5" />
          </Button>
          <div className="flex-1">
            <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
              <Settings className="w-5 h-5" /> Settings
            </h1>
            <p className="text-xs text-muted-foreground">Platform configuration and feature flags</p>
          </div>
          <AdminFinancialSummary />
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => refetch()} className="gap-1.5">
              <RefreshCw className="w-3.5 h-3.5" /> Refresh
            </Button>
            {dirty && (
              <Button variant="ghost" size="sm" onClick={handleReset} className="text-muted-foreground">
                Discard
              </Button>
            )}
            <Button size="sm" onClick={handleSave} disabled={!dirty || saveMutation.isPending} className="gap-1.5">
              <Save className="w-3.5 h-3.5" />
              {saveMutation.isPending ? "Saving…" : "Save Changes"}
            </Button>
          </div>
        </header>

        <main className="flex-1 p-6 max-w-4xl mx-auto w-full space-y-6">

          {/* Unsaved changes banner */}
          {dirty && (
            <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800">
              <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
              <p className="text-xs text-amber-700 dark:text-amber-400 font-medium">You have unsaved changes. Click "Save Changes" to apply them.</p>
            </div>
          )}

          {isLoading ? (
            <div className="space-y-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="h-40 rounded-2xl bg-muted animate-pulse" />
              ))}
            </div>
          ) : (
            <div className="space-y-6">
              {/* System status card */}
              <div className="bg-card border border-border rounded-2xl p-5">
                <div className="flex items-center gap-2 mb-4">
                  <Shield className="w-4 h-4 text-primary" />
                  <h2 className="font-semibold text-foreground text-sm">System Status</h2>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {[
                    { label: "API Server",    ok: true,             note: "Healthy" },
                    { label: "Database",      ok: true,             note: "Connected" },
                    { label: "Paystack Key",  ok: paystackKeySet,   note: paystackKeySet ? "Configured" : "Missing" },
                    { label: "Maintenance",   ok: local.maintenance_mode !== "true", note: local.maintenance_mode === "true" ? "Active" : "Off" },
                  ].map(({ label, ok, note }) => (
                    <div key={label} className="flex items-center gap-2.5 bg-muted/30 rounded-xl px-3 py-2.5">
                      {ok
                        ? <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                        : <AlertCircle className="w-4 h-4 text-red-500 shrink-0" />}
                      <div>
                        <div className="text-xs font-semibold text-foreground">{label}</div>
                        <div className={`text-[10px] ${ok ? "text-emerald-600 dark:text-emerald-400" : "text-red-500"}`}>{note}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Settings sections */}
              {SECTIONS.map(section => (
                <div key={section.key} className="bg-card border border-border rounded-2xl p-5 space-y-5">
                  <div className="flex items-start gap-3 pb-4 border-b border-border">
                    <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                      <section.icon className="w-4 h-4 text-primary" />
                    </div>
                    <div>
                      <h2 className="font-semibold text-foreground text-sm">{section.title}</h2>
                      <p className="text-xs text-muted-foreground">{section.description}</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {section.fields.map(field => (
                      <SettingField
                        key={field.key}
                        field={field}
                        value={local[field.key] ?? DEFAULTS[field.key] ?? ""}
                        onChange={v => handleChange(field.key, v)}
                      />
                    ))}
                  </div>
                </div>
              ))}

              {/* Network Settings */}
              <NetworkSettingsSection
                local={local}
                onToggle={(key, enabled) => {
                  const updated = { ...local, [key]: enabled ? "true" : "false" };
                  setLocal(updated);
                  saveMutation.mutate(updated);
                }}
              />

              {/* McbisSolution Integration */}
              <McbisSolutionSection
                enabled={local.mcbis_enabled === "true"}
                topupghEnabled={local.topupgh_enabled === "true"}
                onToggle={v => {
                  const updated = {
                    ...local,
                    mcbis_enabled:   v ? "true" : "false",
                    topupgh_enabled: v ? "false" : local.topupgh_enabled,
                  };
                  setLocal(updated);
                  saveMutation.mutate(updated);
                }}
              />

              {/* TopUpGH Integration */}
              <TopUpGHSection
                enabled={local.topupgh_enabled === "true"}
                mcbisEnabled={local.mcbis_enabled === "true"}
                minBatch={local.topupgh_min_batch ?? "5"}
                maxBatch={local.topupgh_max_batch ?? "50"}
                onToggle={v => {
                  const updated = {
                    ...local,
                    topupgh_enabled: v ? "true" : "false",
                    mcbis_enabled:   v ? "false" : local.mcbis_enabled,
                  };
                  setLocal(updated);
                  saveMutation.mutate(updated);
                }}
                onBatchChange={(key, val) => handleChange(key, val)}
              />

              {/* Info box */}
              <div className="flex items-start gap-3 px-4 py-3 rounded-xl bg-blue-50 dark:bg-blue-900/10 border border-blue-200 dark:border-blue-800">
                <Info className="w-4 h-4 text-blue-500 shrink-0 mt-0.5" />
                <p className="text-xs text-blue-700 dark:text-blue-400">
                  Settings are stored in the database and take effect immediately after saving.
                  Some feature flags (like maintenance mode) may require a page refresh to reflect for users.
                </p>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
