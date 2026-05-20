import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Navbar } from "@/components/Navbar";
import { useListBundles } from "@workspace/api-client-react";
import { Wifi, Zap, Shield, Headphones, ArrowRight } from "lucide-react";

const WA_CHANNEL = "https://whatsapp.com/channel/0029Vb8GspW4CrfcOKiWBX1u";

const NETWORK_COLORS: Record<string, { bg: string; text: string; label: string }> = {
  mtn:          { bg: "bg-yellow-400",  text: "text-gray-900", label: "MTN" },
  telecel:      { bg: "bg-red-600",     text: "text-white",    label: "Telecel" },
  "at-ishare":  { bg: "bg-blue-600",    text: "text-white",    label: "AT iShare" },
  "at-bigtime": { bg: "bg-green-700",   text: "text-white",    label: "AT Big-Time" },
};

const features = [
  { icon: Zap, title: "Instant Activation", desc: "Your data bundle activates within seconds of purchase." },
  { icon: Shield, title: "Secure Payments", desc: "Bank-grade security protects every transaction." },
  { icon: Headphones, title: "24/7 Support", desc: "Our team is always ready to help you stay connected." },
  { icon: Wifi, title: "Wide Coverage", desc: "Nationwide network coverage for uninterrupted connectivity." },
];

export default function Landing() {
  const { data: bundles } = useListBundles({});
  const featuredBundles = bundles?.slice(0, 3) ?? [];

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Navbar />

      <section className="relative overflow-hidden bg-gradient-to-br from-primary/10 via-background to-accent/20 py-20 md:py-28">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <Badge className="mb-6 bg-primary/10 text-primary border-primary/20" data-testid="badge-hero">
            Fast. Affordable. Reliable.
          </Badge>
          <h1 className="text-4xl md:text-6xl font-extrabold tracking-tight text-foreground mb-6 leading-tight">
            Stay Connected with<br />
            <span className="text-primary">DataBundle</span>
          </h1>
          <p className="text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto mb-10">
            Premium mobile data bundles for every need. Daily, weekly, monthly — pick your plan and stay online, always.
          </p>
          <div className="flex flex-wrap gap-4 justify-center">
            <Link href="/bundles">
              <Button size="lg" className="gap-2" data-testid="button-browse-plans">
                Browse All Plans <ArrowRight className="w-4 h-4" />
              </Button>
            </Link>
            <Link href="/register">
              <Button size="lg" variant="outline" data-testid="button-get-started">
                Create Account
              </Button>
            </Link>
          </div>
        </div>
      </section>

      <section className="py-16 bg-background">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <h2 className="text-2xl md:text-3xl font-bold text-foreground mb-3">Popular Plans</h2>
            <p className="text-muted-foreground">Most-loved bundles by our customers</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {featuredBundles.map((bundle, i) => {
              const net = NETWORK_COLORS[bundle.network ?? ""] ?? { bg: "bg-primary", text: "text-white", label: bundle.network ?? "" };
              return (
                <div
                  key={bundle.id}
                  className="relative rounded-2xl border border-border bg-card overflow-hidden flex flex-col transition-all hover:shadow-lg"
                  data-testid={`card-bundle-${bundle.id}`}
                >
                  {i === 1 && (
                    <div className="absolute top-3 right-3 z-10">
                      <Badge className="bg-primary text-primary-foreground">Most Popular</Badge>
                    </div>
                  )}
                  <div className={`${net.bg} ${net.text} px-5 py-4`}>
                    <div className={`text-xs font-bold uppercase tracking-widest opacity-70 mb-1`}>{net.label}</div>
                    <div className="text-3xl font-extrabold">{bundle.dataAmount}</div>
                  </div>
                  <div className="p-5 flex flex-col flex-1 gap-4">
                    <div className="text-2xl font-extrabold text-foreground">GH₵{bundle.price}</div>
                    <Link href="/bundles" className="mt-auto">
                      <Button className="w-full" variant={i === 1 ? "default" : "outline"} data-testid={`button-select-${bundle.id}`}>
                        Get This Plan
                      </Button>
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="text-center mt-8">
            <Link href="/bundles">
              <Button variant="ghost" className="gap-2" data-testid="button-view-all">
                View all plans <ArrowRight className="w-4 h-4" />
              </Button>
            </Link>
          </div>
        </div>
      </section>

      <section className="py-16 bg-muted/30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <h2 className="text-2xl md:text-3xl font-bold text-foreground mb-3">Why Choose DataBundle</h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {features.map((f) => (
              <div key={f.title} className="bg-card rounded-2xl border border-border p-6 flex flex-col gap-3 hover:shadow-md transition-shadow">
                <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
                  <f.icon className="w-5 h-5 text-primary" />
                </div>
                <h3 className="font-semibold text-foreground">{f.title}</h3>
                <p className="text-sm text-muted-foreground">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="py-20 bg-primary text-primary-foreground">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-3xl md:text-4xl font-bold mb-4">Ready to get connected?</h2>
          <p className="text-primary-foreground/80 mb-8 text-lg">Join thousands of satisfied customers and never run out of data again.</p>
          <Link href="/register">
            <Button size="lg" variant="secondary" className="gap-2" data-testid="button-cta-register">
              Create Free Account <ArrowRight className="w-4 h-4" />
            </Button>
          </Link>
        </div>
      </section>

      {/* WhatsApp Channel Banner */}
      <section className="bg-[#25D366] py-5">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3 text-white">
            <svg className="w-7 h-7 fill-white shrink-0" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
              <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
            </svg>
            <div>
              <p className="font-semibold text-white">Stay updated on our WhatsApp Channel</p>
              <p className="text-white/80 text-sm">Get deals, alerts, and service updates instantly.</p>
            </div>
          </div>
          <a
            href={WA_CHANNEL}
            target="_blank"
            rel="noopener noreferrer"
            className="shrink-0 bg-white text-[#128C4A] font-semibold text-sm px-5 py-2.5 rounded-xl hover:bg-green-50 transition-colors"
          >
            Join Channel
          </a>
        </div>
      </section>

      <footer className="border-t border-border py-8 bg-background">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2 font-bold text-lg">
            <div className="w-7 h-7 rounded-lg bg-primary flex items-center justify-center">
              <Wifi className="w-3.5 h-3.5 text-primary-foreground" />
            </div>
            <span>DataBundle</span>
          </div>
          <div className="flex items-center gap-4">
            <a
              href={WA_CHANNEL}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 text-sm text-[#128C4A] hover:underline font-medium"
            >
              <svg className="w-3.5 h-3.5 fill-[#128C4A]" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
              </svg>
              WhatsApp Channel
            </a>
            <p className="text-sm text-muted-foreground">© 2025 DataBundle. All rights reserved.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
