"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMemo, useState, type ReactNode } from "react";
import { Search } from "lucide-react";
import { StatusBadge, stateBar } from "@/components/status-badge";
import type { ConversationKind } from "@/lib/conversation-state";

export interface ConversationRow {
  id: string;
  name: string;
  phone: string;
  channelLabel: string;
  preview: string;
  previewFrom: string;
  since: string;
  kind: ConversationKind;
  stateLabel: string;
}

/**
 * Caixa de atendimento: lista + conversa aberta lado a lado (desktop);
 * no celular, uma de cada vez conforme a rota.
 */
export function ConversationsShell({ rows, children }: { rows: ConversationRow[]; children: ReactNode }) {
  const pathname = usePathname();
  const openId = pathname.split("/")[2];
  const [onlyWaiting, setOnlyWaiting] = useState(false);
  const [query, setQuery] = useState("");
  const waiting = rows.filter((r) => r.kind === "waiting").length;

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter(
      (r) =>
        (!onlyWaiting || r.kind === "waiting") &&
        (!q || r.name.toLowerCase().includes(q) || r.phone.replace(/\D/g, "").includes(q.replace(/\D/g, "") || "\u0000")),
    );
  }, [rows, onlyWaiting, query]);

  return (
    <div className="md:grid md:h-dvh md:grid-cols-[minmax(300px,360px)_1fr]">
      <div className={`flex-col border-border md:flex md:h-dvh md:border-r ${openId ? "hidden" : "flex"}`}>
        <div className="space-y-3 px-4 pt-6 pb-3 md:pt-7">
          <h1 className="px-1 text-[1.75rem] leading-tight font-bold">Atendimento</h1>
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar nome ou telefone"
              aria-label="Buscar conversa"
              className="h-10 w-full rounded-md border border-input bg-card pr-3 pl-9 text-[15px] outline-none placeholder:text-muted-foreground focus-visible:border-ring"
            />
          </div>
          <div role="tablist" aria-label="Filtrar conversas" className="flex gap-1 rounded-md bg-muted p-1 text-sm">
            {[
              { on: false, label: "Todas" },
              { on: true, label: `Precisa de você${waiting ? ` (${waiting})` : ""}` },
            ].map((t) => (
              <button
                key={t.label}
                type="button"
                role="tab"
                aria-selected={onlyWaiting === t.on}
                onClick={() => setOnlyWaiting(t.on)}
                className={`flex-1 rounded px-2 py-1.5 font-medium ${
                  onlyWaiting === t.on ? "bg-card text-foreground shadow-sm" : "text-muted-foreground"
                } ${t.on && waiting ? "aria-[selected=false]:text-alert" : ""}`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        <ul className="flex-1 overflow-y-auto pb-6">
          {visible.length === 0 && (
            <li className="px-5 py-10 text-center text-sm text-muted-foreground">
              {onlyWaiting ? "Ninguém esperando atendimento agora." : "Nenhuma conversa encontrada."}
            </li>
          )}
          {visible.map((r) => (
            <li key={r.id}>
              <Link
                href={`/conversations/${r.id}`}
                aria-current={r.id === openId ? "page" : undefined}
                className={`block border-b border-border/70 px-5 py-3.5 transition-colors hover:bg-card ${stateBar(r.kind)} ${
                  r.id === openId ? "bg-card" : ""
                }`}
              >
                <div className="flex items-baseline justify-between gap-3">
                  <span className="truncate font-semibold">{r.name}</span>
                  <span className={`shrink-0 text-xs tabular-nums ${r.kind === "waiting" ? "font-semibold text-alert" : "text-muted-foreground"}`}>
                    {r.since}
                  </span>
                </div>
                <p className="mt-0.5 truncate text-sm text-muted-foreground">
                  {r.previewFrom && <span className="text-foreground/80">{r.previewFrom}: </span>}
                  {r.preview}
                </p>
                {r.kind !== "ai" && (
                  <div className="mt-2">
                    <StatusBadge kind={r.kind} label={r.stateLabel} />
                  </div>
                )}
              </Link>
            </li>
          ))}
        </ul>
      </div>

      <div className={`min-w-0 md:block md:h-dvh md:overflow-hidden ${openId ? "block" : "hidden"}`}>{children}</div>
    </div>
  );
}
