"use client";

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ensureChannel, logoutChannel } from "@/app/(app)/actions";
import { prettyPhone } from "@/lib/conversation-state";

type Status = {
  state: string;
  detail?: string;
  phone?: string;
  verifiedName?: string;
  qr: string | null;
};

const LABEL: Record<string, string> = {
  WORKING: "Conectado",
  SCAN_QR: "Aguardando leitura do QR",
  STARTING: "Iniciando…",
  STOPPED: "Parado",
  NOT_CREATED: "Não iniciado",
  NOT_CONFIGURED: "Servidor não configurado",
  FAILED: "Falhou",
};

export function WahaConnect({ initial }: { initial: Status }) {
  const [status, setStatus] = useState<Status>(initial);
  const [pending, startTransition] = useTransition();

  // Badge e QR vêm sempre do GET (polling), nunca do retorno do POST.
  useEffect(() => {
    if (status.state === "NOT_CONFIGURED") return;
    const fast = ["SCAN_QR", "STARTING"].includes(status.state);
    const id = setInterval(async () => {
      const r = await fetch("/api/sessions/waha/status", { cache: "no-store" }).catch(() => null);
      if (r?.ok) setStatus(await r.json());
    }, fast ? 2000 : 10000);
    return () => clearInterval(id);
  }, [status.state]);

  const run = (fn: () => Promise<{ ok: boolean; message: string } | null>) =>
    startTransition(async () => {
      const res = await fn();
      if (res && !res.ok) toast.error(res.message);
      const r = await fetch("/api/sessions/waha/status", { cache: "no-store" }).catch(() => null);
      if (r?.ok) setStatus(await r.json());
    });

  const working = status.state === "WORKING";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Badge variant={working ? "default" : status.state === "FAILED" ? "destructive" : "secondary"}>
          {LABEL[status.state] ?? status.state}
        </Badge>
        {working && (
          <span className="text-sm text-muted-foreground">
            {[status.verifiedName, status.phone && prettyPhone(status.phone)].filter(Boolean).join(", ")}
          </span>
        )}
      </div>

      {status.detail && status.state !== "WORKING" && (
        <p className="text-sm text-muted-foreground">{status.detail}</p>
      )}

      {status.state === "SCAN_QR" && status.qr && (
        <div className="space-y-2">
          {/* eslint-disable-next-line @next/next/no-img-element -- data URI do Waha */}
          <img src={status.qr} alt="QR code para conectar o WhatsApp" className="size-64 rounded-lg border border-border bg-white p-3" />
          <p className="max-w-sm text-sm text-muted-foreground">
            No celular do número, abra o WhatsApp, vá em Configurações, Aparelhos conectados e toque em Conectar um aparelho. O QR se atualiza sozinho.
          </p>
        </div>
      )}

      {status.state !== "NOT_CONFIGURED" && (
        <div className="flex gap-2">
          {!working && status.state !== "SCAN_QR" && status.state !== "STARTING" && (
            <Button disabled={pending} onClick={() => run(() => ensureChannel("waha"))}>
              {pending ? "Aguarde…" : "Conectar por QR code"}
            </Button>
          )}
          {working && (
            <>
              <Button variant="outline" disabled={pending} onClick={() => run(() => ensureChannel("waha"))}>
                Verificar de novo
              </Button>
              <Button
                variant="destructive"
                disabled={pending}
                onClick={() => {
                  if (confirm("Desconectar este número do agente?")) run(() => logoutChannel("waha"));
                }}
              >
                Desconectar número
              </Button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
