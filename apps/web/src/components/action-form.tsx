"use client";

import { useActionState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import type { ActionState } from "@/app/(app)/actions";

/** Form com server action + feedback inline (sucesso em verde, erro em vermelho). */
export function ActionForm({
  action,
  submitLabel,
  children,
  className,
}: {
  action: (prev: ActionState, form: FormData) => Promise<ActionState>;
  submitLabel: string;
  children?: ReactNode;
  className?: string;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  return (
    <form action={formAction} className={className ?? "space-y-4"}>
      {children}
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Aguarde…" : submitLabel}
        </Button>
        {state && (
          <p
            className={`whitespace-pre-wrap text-sm ${state.ok ? "text-success" : "text-destructive"}`}
            role="status"
          >
            {state.message}
          </p>
        )}
      </div>
    </form>
  );
}
