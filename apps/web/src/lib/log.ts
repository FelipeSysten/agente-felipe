// Structured logging: 1 linha JSON por evento (§12.1). Nunca logar tokens/keys.
export function logEvent(event: string, data: Record<string, unknown> = {}) {
  console.log(JSON.stringify({ event, at: new Date().toISOString(), ...data }));
}

export function logError(event: string, err: unknown, data: Record<string, unknown> = {}) {
  console.error(
    JSON.stringify({ event, at: new Date().toISOString(), err: String(err), ...data }),
  );
}
