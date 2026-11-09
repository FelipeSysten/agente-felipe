"use client";

import { useEffect, useRef } from "react";

/**
 * Mantém a conversa rolada até a última mensagem — ao abrir e quando chega
 * mensagem nova, mas só se a pessoa já estava perto do fim (não atrapalha quem
 * está lendo o histórico).
 */
export function ScrollToBottom({ count, targetId }: { count: number; targetId: string }) {
  const first = useRef(true);
  useEffect(() => {
    const el = document.getElementById(targetId);
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 160;
    if (first.current || nearBottom) el.scrollTop = el.scrollHeight;
    first.current = false;
  }, [count, targetId]);
  return null;
}
