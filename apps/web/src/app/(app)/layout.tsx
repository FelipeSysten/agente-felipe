import { LogOut } from "lucide-react";
import { prisma } from "@/lib/db";
import { visibleConversations } from "@/lib/lines";
import { requireUser } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { NavLinks, type NavItem } from "@/components/nav-links";
import { logout } from "./actions";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const email = await requireUser();
  const [waiting, pendingLessons] = await Promise.all([
    (async () => prisma.conversation.count({ where: { AND: [await visibleConversations(), { handoffRequested: true }] } }))(),
    prisma.lesson.count({ where: { status: "pending" } }),
  ]);

  const items: NavItem[] = [
    { href: "/dashboard", label: "Hoje", icon: "Sun" },
    { href: "/conversations", label: "Atendimento", icon: "Inbox", count: waiting, urgent: true },
    { href: "/learning", label: "Ensinar a IA", icon: "GraduationCap", count: pendingLessons },
    { href: "/agents", label: "Agente", icon: "Bot" },
    { href: "/onboarding", label: "WhatsApp", icon: "Smartphone" },
    { href: "/settings", label: "Ajustes", icon: "Settings" },
  ];

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <aside className="border-b border-sidebar-border bg-sidebar md:sticky md:top-0 md:flex md:h-screen md:w-60 md:shrink-0 md:flex-col md:border-r md:border-b-0">
        <div className="px-6 pt-5 pb-4">
          <p className="text-lg leading-tight font-bold tracking-tight">Gaúcho</p>
          <p className="text-sm text-muted-foreground">Atendimento no WhatsApp</p>
        </div>
        <NavLinks items={items} />
        <div className="mt-auto hidden border-t border-sidebar-border px-6 py-4 md:block">
          <p className="truncate text-sm text-muted-foreground" title={email}>
            {email}
          </p>
          <form action={logout}>
            {/* type="submit" explícito: o Button do Base UI é type="button" por padrão */}
            <Button type="submit" variant="ghost" size="sm" className="mt-1 -ml-2 text-muted-foreground">
              <LogOut aria-hidden /> Sair
            </Button>
          </form>
        </div>
      </aside>
      <main className="min-w-0 flex-1">{children}</main>
      {/* Celular: sair fica no fim da página */}
      <form action={logout} className="border-t border-sidebar-border px-4 py-3 md:hidden">
        <Button type="submit" variant="ghost" size="sm" className="text-muted-foreground">
          <LogOut aria-hidden /> Sair ({email})
        </Button>
      </form>
    </div>
  );
}
