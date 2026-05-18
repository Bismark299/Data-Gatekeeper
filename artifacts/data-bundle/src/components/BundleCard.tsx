export type NetworkKey = "mtn" | "telecel" | "at-ishare" | "at-bigtime";

export const NETWORK_LABELS: Record<string, string> = {
  mtn: "MTN",
  telecel: "Telecel",
  "at-ishare": "AT iShare",
  "at-bigtime": "AT Big-Time",
};

// Network style map — exact colours from network-card-designs.txt
const CARD_STYLES: Record<string, {
  bodyBg: string; text: string; badge: string;
  badgeBorder: string; footerBg: string; footerText: string;
}> = {
  mtn: {
    bodyBg:      "#F5C518",
    text:        "text-black",
    badge:       "MTN",
    badgeBorder: "border-gray-600 text-gray-600",
    footerBg:    "#4a4a4a",
    footerText:  "#e5e5e5",
  },
  telecel: {
    bodyBg:      "rgb(229,57,53)",
    text:        "text-white",
    badge:       "T",
    badgeBorder: "border-white text-white",
    footerBg:    "#2d2d2d",
    footerText:  "#ffffff",
  },
  "at-ishare": {
    bodyBg:      "#0033A0",
    text:        "text-white",
    badge:       "AT",
    badgeBorder: "border-white text-white",
    footerBg:    "#E4002B",
    footerText:  "#ffffff",
  },
  "at-bigtime": {
    bodyBg:      "#0033A0",
    text:        "text-white",
    badge:       "AT",
    badgeBorder: "border-white text-white",
    footerBg:    "#E4002B",
    footerText:  "#ffffff",
  },
};

// Keep NETWORK_STYLES exported for network selector cards (bundles.tsx / public-store.tsx)
export const NETWORK_STYLES: Record<string, {
  gradient: string; text: string; badge: string;
  shimmer: string; glow: string; ctaBg: string; ctaText: string;
}> = {
  mtn: {
    gradient: "bg-gradient-to-br from-[#FFCC00] via-[#FFB800] to-[#E6A500]",
    text: "text-gray-900", badge: "bg-black/15 text-gray-900 border-black/20",
    shimmer: "from-white/50 via-white/10 to-transparent",
    glow: "shadow-[0_8px_40px_rgba(255,184,0,0.45)]",
    ctaBg: "bg-black/80", ctaText: "text-yellow-400",
  },
  telecel: {
    gradient: "bg-gradient-to-br from-[#F44336] via-[#C62828] to-[#7B0000]",
    text: "text-white", badge: "bg-white/20 text-white border-white/30",
    shimmer: "from-white/25 via-white/5 to-transparent",
    glow: "shadow-[0_8px_40px_rgba(198,40,40,0.45)]",
    ctaBg: "bg-black/80", ctaText: "text-red-400",
  },
  "at-ishare": {
    gradient: "bg-gradient-to-br from-[#2196F3] via-[#1565C0] to-[#0D2E78]",
    text: "text-white", badge: "bg-white/20 text-white border-white/30",
    shimmer: "from-white/25 via-white/5 to-transparent",
    glow: "shadow-[0_8px_40px_rgba(21,101,192,0.45)]",
    ctaBg: "bg-black/80", ctaText: "text-blue-400",
  },
  "at-bigtime": {
    gradient: "bg-gradient-to-br from-[#4CAF50] via-[#2E7D32] to-[#1A3A1C]",
    text: "text-white", badge: "bg-white/20 text-white border-white/30",
    shimmer: "from-white/25 via-white/5 to-transparent",
    glow: "shadow-[0_8px_40px_rgba(46,125,50,0.45)]",
    ctaBg: "bg-black/80", ctaText: "text-green-400",
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

export function BundleCard({
  dataAmount, network, price, validityDays,
  insufficient, onClick, className = "",
  "data-testid": testId,
}: BundleCardProps) {
  const style = CARD_STYLES[network] ?? CARD_STYLES["at-ishare"];

  return (
    <div
      className={`package-card relative rounded-xl overflow-hidden shadow-lg
        cursor-pointer transition-all duration-300
        hover:shadow-xl hover:-translate-y-1 active:-translate-y-0.5
        ${insufficient ? "opacity-60 cursor-not-allowed" : ""}
        ${className}`}
      onClick={insufficient ? undefined : onClick}
      data-testid={testId}
    >
      {/* Out of stock / low balance overlay */}
      {insufficient && (
        <div className="absolute inset-0 bg-black/50 z-10 flex items-center justify-center">
          <span className="bg-red-600 text-white px-4 py-2 rounded-full text-sm font-bold shadow-lg">
            LOW BALANCE
          </span>
        </div>
      )}

      {/* Card body — coloured top section */}
      <div
        className="relative p-4 sm:p-5 text-center"
        style={{ backgroundColor: style.bodyBg }}
      >
        {/* Network badge top-left */}
        <span className={`absolute top-3 left-3 border-2 ${style.badgeBorder} rounded-full px-3 py-0.5 text-xs font-bold`}>
          {style.badge}
        </span>
        {/* Data size */}
        <p className={`${style.text} text-3xl sm:text-4xl font-bold mt-4`}>{dataAmount}</p>
      </div>

      {/* Card footer — dark bottom section, 3 columns */}
      <div
        className="p-2 grid grid-cols-3 gap-1 text-center"
        style={{ backgroundColor: style.footerBg, color: style.footerText }}
      >
        <div>
          <p className="text-sm font-semibold">GH₵{price.toFixed(2)}</p>
          <p className="text-xs" style={{ color: "#9ca3af" }}>Price</p>
        </div>
        <div>
          <p className="text-sm font-semibold">N/A</p>
          <p className="text-xs" style={{ color: "#9ca3af" }}>Rollover</p>
        </div>
        <div>
          <p className="text-sm font-semibold">∞</p>
          <p className="text-xs" style={{ color: "#9ca3af" }}>Duration</p>
        </div>
      </div>
    </div>
  );
}

/** Mini card for use inside dialogs/receipts */
export function BundleCardMini({
  dataAmount, network, price, validityDays, phone,
}: { dataAmount: string; network: string; price: number; validityDays: number; phone?: string }) {
  const style = CARD_STYLES[network] ?? CARD_STYLES["at-ishare"];

  return (
    <div className="rounded-xl overflow-hidden shadow-lg">
      {/* Card body */}
      <div className="relative p-4 text-center" style={{ backgroundColor: style.bodyBg }}>
        <span className={`absolute top-3 left-3 border-2 ${style.badgeBorder} rounded-full px-3 py-0.5 text-xs font-bold`}>
          {style.badge}
        </span>
        <p className={`${style.text} text-4xl font-bold mt-4`}>{dataAmount}</p>
      </div>
      {/* Card footer */}
      <div
        className="p-2 grid grid-cols-3 gap-1 text-center"
        style={{ backgroundColor: style.footerBg, color: style.footerText }}
      >
        <div>
          <p className="text-sm font-semibold">GH₵{price.toFixed(2)}</p>
          <p className="text-xs" style={{ color: "#9ca3af" }}>Price</p>
        </div>
        <div>
          <p className="text-sm font-semibold">{phone ?? "N/A"}</p>
          <p className="text-xs" style={{ color: "#9ca3af" }}>{phone ? "Number" : "Rollover"}</p>
        </div>
        <div>
          <p className="text-sm font-semibold">∞</p>
          <p className="text-xs" style={{ color: "#9ca3af" }}>Duration</p>
        </div>
      </div>
    </div>
  );
}
