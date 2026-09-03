"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  CreditCard,
  Home,
  Package,
  Settings,
  Store,
  Users,
  UtensilsCrossed,
  Timer,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Navigation minimale — dérivée du workflow direction :
 * Accueil (priorités) → Stock (exceptions) → Ventes → Équipe → Plus
 * Sites / Menu / Billing restent accessibles via sidebar desktop + Plus.
 */
const SIDEBAR: { href: string; label: string; icon: LucideIcon }[] = [
  { href: "/direction", label: "Accueil", icon: Home },
  { href: "/direction/stock", label: "Stock", icon: Package },
  { href: "/direction/ventes", label: "Ventes", icon: BarChart3 },
  { href: "/direction/activite", label: "Activité", icon: Timer },
  { href: "/direction/menu", label: "Menu", icon: UtensilsCrossed },
  { href: "/direction/equipe", label: "Équipe", icon: Users },
  { href: "/direction/etablissements", label: "Sites", icon: Store },
  { href: "/direction/abonnement", label: "Billing", icon: CreditCard },
  { href: "/direction/reglages", label: "Réglages", icon: Settings },
];

const MOBILE: { href: string; label: string; icon: LucideIcon }[] = [
  { href: "/direction", label: "Accueil", icon: Home },
  { href: "/direction/stock", label: "Stock", icon: Package },
  { href: "/direction/ventes", label: "Ventes", icon: BarChart3 },
  { href: "/direction/equipe", label: "Équipe", icon: Users },
  { href: "/direction/reglages", label: "Plus", icon: Settings },
];

function isActive(pathname: string, href: string) {
  return href === "/direction" ? pathname === href : pathname.startsWith(href);
}

export function DirectionSidebarNav() {
  const pathname = usePathname();
  return (
    <nav className="flex flex-col gap-0.5" aria-label="Direction">
      {SIDEBAR.map(({ href, label, icon: Icon }) => (
        <Link
          key={href}
          href={href}
          className={cn(
            "flex h-9 items-center gap-2.5 rounded-md px-2.5 text-[13px] font-medium tracking-tight transition-colors",
            isActive(pathname, href) ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted/70 hover:text-foreground"
          )}
        >
          <Icon className="h-4 w-4 stroke-[1.6]" />
          {label}
        </Link>
      ))}
    </nav>
  );
}

export function DirectionMobileNav() {
  const pathname = usePathname();
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 flex items-stretch justify-around border-t border-border bg-card pb-[env(safe-area-inset-bottom)] md:hidden"
      aria-label="Navigation principale"
    >
      {MOBILE.map(({ href, label, icon: Icon }) => {
        const active = isActive(pathname, href);
        return (
          <Link
            key={href}
            href={href}
            className={cn(
              "flex min-h-14 flex-1 flex-col items-center justify-center gap-1 text-[10px] font-medium tracking-tight",
              active ? "text-foreground" : "text-muted-foreground"
            )}
          >
            <Icon className={cn("h-[18px] w-[18px] stroke-[1.6]", active && "text-foreground")} />
            <span>{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
