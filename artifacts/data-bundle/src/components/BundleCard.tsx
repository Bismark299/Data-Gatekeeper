import { Zap } from "lucide-react";

export type NetworkKey = "mtn" | "telecel" | "at-ishare" | "at-bigtime";

export const NETWORK_LABELS: Record<string, string> = {
  mtn: "MTN",
  telecel: "Telecel",
  "at-ishare": "AT iShare",
  "at-bigtime": "AT Big-Time",
};

export const NETWORK_STYLES: Record<string, {
  gradient: string; text: string; badge: string;
  shimmer: string; glow: string; ctaBg: string; ctaText: string;
}> = {
  mtn: {
    gradient:  "bg-gradient-to-br from-[#FFCC00] via-[#FFB800] to-[#E6A500]",
    text:      "text-gray-900",
    badge:     "bg-black/15 text-gray-900 border-black/20",
    shimmer:   "from-white/50 via-white/10 to-transparent",
    glow:      "shadow-[0_8px_40px_rgba(255,184,0,0.45)]",
    ctaBg:     "bg-black/80",
    ctaText:   "text-yellow-400",
  },
  telecel: {
    gradient:  "bg-gradient-to-br from-[#F44336] via-[#C62828] to-[#7B0000]",
    text:      "text-white",
    badge:     "bg-white/20 text-white border-white/30",
    shimmer:   "from-white/25 via-white/5 to-transparent",
    glow:      "shadow-[0_8px_40px_rgba(198,40,40,0.45)]",
    ctaBg:     "bg-black/80",
    ctaText:   "text-red-400",
  },
  "at-ishare": {
    gradient:  "bg-gradient-to-br from-[#2196F3] via-[#1565C0] to-[#0D2E78]",
    text:      "text-white",
    badge:     "bg-white/20 text-white border-white/30",
    shimmer:   "from-white/25 via-white/5 to-transparent",
    glow:      "shadow-[0_8px_40px_rgba(21,101,192,0.45)]",
    ctaBg:     "bg-black/80",
    ctaText:   "text-blue-400",
  },
  "at-bigtime": {
    gradient:  "bg-gradient-to-br from-[#4CAF50] via-[#2E7D32] to-[#1A3A1C]",
    text:      "text-white",
    badge:     "bg-white/20 text-white border-white/30",
    shimmer:   "from-white/25 via-white/5 to-transparent",
    glow:      "shadow-[0_8px_40px_rgba(46,125,50,0.45)]",
    ctaBg:     "bg-black/80",
    ctaText:   "text-green-400",
  },
};

export interface BundleCardProps {
  dataAmount: string;
  network: string;
  price: number;
  validityDays: number;
  insufficient?: boolean;
  ctaLabel?: string;
  showBuyHover?: boolean;
  onClick?: () => void;
  className?: string;
  "data-testid"?: string;
}

function formatDuration(days: number) {
  if (!days) return "No Expiry";
  return `${days} Day${days !== 1 ? "s" : ""}`;
}

export function BundleCard({
  dataAmount, network, price, validityDays,
  insufficient, ctaLabel, showBuyHover = true, onClick, className = "",
  "data-testid": testId,
}: BundleCardProps) {
  const style = NETWORK_STYLES[network] ?? NETWORK_STYLES["at-ishare"];
  const label = NETWORK_LABELS[network] ?? network.toUpperCase();

  return (
    <div
      className={`group relative rounded-2xl overflow-hidden cursor-pointer transition-all duration-300
        hover:-translate-y-1.5 hover:scale-[1.01] border border-white/10
        ${style.glow} hover:shadow-[0_16px_60px_rgba(0,0,0,0.4)]
        ${className}`}
      onClick={onClick}
      data-testid={testId}
    >
      {/* Gradient background */}
      <div className={`relative ${style.gradient} pt-5 pb-5 px-4`}>
        {/* Top shimmer */}
        <div className={`absolute inset-0 bg-gradient-to-b ${style.shimmer} pointer-events-none`} />

        {/* Network badge */}
        <div className={`relative inline-flex items-center px-2.5 py-1 rounded-full text-[10px] font-extrabold tracking-widest border backdrop-blur-sm mb-5 ${style.badge}`}>
          {label}
        </div>

        {/* Buy Now hover pill */}
        {showBuyHover && (
          <div className="absolute top-4 right-4 opacity-0 group-hover:opacity-100 transition-all duration-200 translate-y-1 group-hover:translate-y-0">
            <span className={`flex items-center gap-1 bg-black/30 backdrop-blur-md ${style.text} text-[10px] font-bold px-2.5 py-1 rounded-full border border-white/20`}>
              <Zap className="w-2.5 h-2.5" /> Buy
            </span>
          </div>
        )}

        {/* Glass data amount panel */}
        <div className="relative flex items-center justify-center py-1">
          <div className="absolute inset-0 rounded-2xl bg-black/10 backdrop-blur-sm border border-white/15" />
          <span className={`relative text-5xl font-black tracking-tight leading-none py-5 px-6 ${style.text}`} style={{ textShadow: "0 2px 8px rgba(0,0,0,0.15)" }}>
            {dataAmount}
          </span>
        </div>

        {/* Insufficient overlay */}
        {insufficient && (
          <div className="absolute inset-0 bg-black/40 backdrop-blur-[1px] flex items-center justify-center">
            <span className="text-xs font-bold text-white bg-red-600/90 px-3 py-1.5 rounded-full">Low Balance</span>
          </div>
        )}
      </div>

      {/* Info bar */}
      <div className={`${style.ctaBg} backdrop-blur-sm grid grid-cols-3 divide-x divide-white/10`}>
        <div className="py-3 px-2 text-center">
          <div className={`text-sm font-bold ${insufficient ? "text-red-400" : style.ctaText}`}>GH₵{price.toFixed(2)}</div>
          <div className="text-[10px] text-gray-500 mt-0.5 uppercase tracking-wide">Price</div>
        </div>
        <div className="py-3 px-2 text-center">
          <div className={`text-sm font-bold ${style.ctaText}`}>N/A</div>
          <div className="text-[10px] text-gray-500 mt-0.5 uppercase tracking-wide">Rollover</div>
        </div>
        <div className="py-3 px-2 text-center">
          <div className={`text-sm font-bold ${style.ctaText}`}>{formatDuration(validityDays)}</div>
          <div className="text-[10px] text-gray-500 mt-0.5 uppercase tracking-wide">Duration</div>
        </div>
      </div>

      {/* Optional CTA bar */}
      {ctaLabel && (
        <div className={`${style.gradient} py-2.5 text-center text-sm font-bold ${style.text} tracking-wide group-hover:brightness-105 transition-all`}>
          {ctaLabel}
        </div>
      )}
    </div>
  );
}

/** Mini card for use inside dialogs/receipts */
export function BundleCardMini({
  dataAmount, network, price, validityDays, phone,
}: { dataAmount: string; network: string; price: number; validityDays: number; phone?: string }) {
  const style = NETWORK_STYLES[network] ?? NETWORK_STYLES["at-ishare"];
  const label = NETWORK_LABELS[network] ?? network.toUpperCase();

  return (
    <div className={`rounded-2xl overflow-hidden border border-white/10 ${style.glow}`}>
      <div className={`relative ${style.gradient} flex items-center justify-center py-8`}>
        <div className={`absolute inset-0 bg-gradient-to-b ${style.shimmer} pointer-events-none`} />
        <div className={`absolute top-3 left-3 inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-extrabold border backdrop-blur-sm ${style.badge}`}>{label}</div>
        <div className="relative text-5xl font-black" style={{ textShadow: "0 2px 8px rgba(0,0,0,0.15)" }}>
          <span className={style.text}>{dataAmount}</span>
        </div>
      </div>
      <div className="bg-[#1a1a1a] grid grid-cols-3 divide-x divide-white/10">
        <div className="py-3 text-center"><div className="text-sm font-bold text-white">GH₵{price.toFixed(2)}</div><div className="text-[10px] text-gray-500 uppercase">Price</div></div>
        <div className="py-3 text-center"><div className="text-sm font-bold text-white">{phone ?? "N/A"}</div><div className="text-[10px] text-gray-500 uppercase">{phone ? "Number" : "Rollover"}</div></div>
        <div className="py-3 text-center"><div className="text-sm font-bold text-white">{formatDuration(validityDays)}</div><div className="text-[10px] text-gray-500 uppercase">Duration</div></div>
      </div>
    </div>
  );
}
