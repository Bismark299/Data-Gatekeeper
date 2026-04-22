import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Navbar } from "@/components/Navbar";
import { useListBundles } from "@workspace/api-client-react";
import { Wifi, Zap, Shield, Headphones, ArrowRight } from "lucide-react";

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

      <footer className="border-t border-border py-8 bg-background">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2 font-bold text-lg">
            <div className="w-7 h-7 rounded-lg bg-primary flex items-center justify-center">
              <Wifi className="w-3.5 h-3.5 text-primary-foreground" />
            </div>
            <span>DataBundle</span>
          </div>
          <p className="text-sm text-muted-foreground">© 2025 DataBundle. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
}
