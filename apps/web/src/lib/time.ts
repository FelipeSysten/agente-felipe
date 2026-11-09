/** Agora, em ms (por request no servidor; fora do corpo dos componentes). */
export function nowMs(): number {
  return Date.now();
}

/** Instante de N horas atrás (calculado por request no servidor). */
export function hoursAgo(hours: number): Date {
  return new Date(Date.now() - hours * 3_600_000);
}

/** O instante ainda não chegou? (calculado por request no servidor) */
export function isFuture(date: Date | null | undefined): date is Date {
  return Boolean(date && date.getTime() > Date.now());
}

/** A janela de atendimento de 24h da Meta ainda está aberta? */
export function within24h(lastInboundAt: Date | null): boolean {
  return Boolean(lastInboundAt && lastInboundAt > hoursAgo(24));
}
