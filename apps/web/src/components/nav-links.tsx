"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { GraduationCap, Inbox, Settings, Smartphone, Sun, Bot } from "lucide-react";

const ICONS = { Sun, Inbox, GraduationCap, Bot, Smartphone, Settings };

export interface NavItem {
  href: string;
  label: string;
  icon: keyof typeof ICONS;
  /** Contador ao lado do nome; `urgent` pinta de alerta (alguém esperando). */
  count?: number;
  urgent?: boolean;
}

export function NavLinks({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Seções" className="flex gap-1 overflow-x-auto px-3 pb-3 md:flex-col md:overflow-visible md:pb-0">
      {items.map(({ href, label, icon, count, urgent }) => {
        const Icon = ICONS[icon];
        const active = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={`flex items-center gap-2.5 rounded-md px-3 py-2 text-[15px] whitespace-nowrap transition-colors ${
              active
                ? "bg-card font-semibold text-foreground shadow-[inset_3px_0_0_var(--primary)]"
                : "text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
            }`}
          >
            <Icon className="size-4 shrink-0" aria-hidden />
            {label}
            {count ? (
              <span
                className={`ml-auto min-w-5 rounded-full px-1.5 text-center text-xs font-semibold tabular-nums ${
                  urgent ? "bg-alert text-white" : "bg-accent text-accent-foreground"
                }`}
              >
                {count}
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
