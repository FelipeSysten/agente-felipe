import type { ConversationKind } from "@/lib/conversation-state";

const STYLE: Record<ConversationKind, string> = {
  waiting: "bg-alert-soft text-alert",
  human: "bg-amber-soft text-amber",
  paused: "bg-amber-soft text-amber",
  ai: "bg-accent text-accent-foreground",
};

/** Etiqueta de estado da conversa — a cor carrega o significado, o texto confirma. */
export function StatusBadge({ kind, label }: { kind: ConversationKind; label: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ${STYLE[kind]}`}>
      <span
        aria-hidden
        className={`size-1.5 rounded-full ${kind === "waiting" ? "bg-alert" : kind === "ai" ? "bg-primary" : "bg-amber"}`}
      />
      {label}
    </span>
  );
}

/** Barra lateral colorida das linhas de conversa (o elemento "memorável" do painel). */
export function stateBar(kind: ConversationKind): string {
  return kind === "waiting"
    ? "shadow-[inset_4px_0_0_var(--alert)]"
    : kind === "human" || kind === "paused"
      ? "shadow-[inset_4px_0_0_var(--amber)]"
      : "";
}
