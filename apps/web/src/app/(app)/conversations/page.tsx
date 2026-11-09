import { MessagesSquare } from "lucide-react";

/** Desktop: lado direito vazio até escolher uma conversa (no celular a lista ocupa a tela). */
export default function ConversationsIndex() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-8 text-center text-muted-foreground">
      <MessagesSquare className="size-10 text-primary/60" aria-hidden />
      <p className="max-w-xs text-[15px]">
        Escolha uma conversa para ler e responder. Quem pediu atendente aparece no topo, com a barra vermelha.
      </p>
    </div>
  );
}
