"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { passwordLogin, requestLink } from "./actions";

function Feedback({ state }: { state: { ok: boolean; message: string } | null }) {
  if (!state) return null;
  return (
    <p className={`text-sm ${state.ok ? "text-success" : "text-destructive"}`} role="status">
      {state.message}
    </p>
  );
}

export function PasswordForm() {
  const [state, action, pending] = useActionState(passwordLogin, null);
  return (
    <form action={action} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="login">Login ou e-mail</Label>
        <Input id="login" name="login" autoComplete="username" autoCapitalize="none" required />
      </div>
      <div className="space-y-2">
        <Label htmlFor="password">Senha</Label>
        <Input id="password" name="password" type="password" autoComplete="current-password" required />
      </div>
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Entrando…" : "Entrar"}
      </Button>
      <Feedback state={state} />
    </form>
  );
}

export function LoginForm() {
  const [state, action, pending] = useActionState(requestLink, null);
  return (
    <form action={action} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="email">E-mail</Label>
        <Input id="email" name="email" type="email" autoComplete="email" required placeholder="voce@exemplo.com" />
      </div>
      <Button type="submit" variant="outline" className="w-full" disabled={pending}>
        {pending ? "Enviando…" : "Enviar link de acesso"}
      </Button>
      <Feedback state={state} />
    </form>
  );
}
