/**
 * Forma canônica p/ comparar telefones: só dígitos e, no Brasil, sem o nono dígito.
 * O WhatsApp pode registrar o mesmo celular como 5573 9 9909-1977 ou 557399091977.
 * Aceita "5573…@c.us", "5573…:12@s.whatsapp.net" ou só dígitos.
 */
export function canonicalPhone(raw: string | null | undefined): string {
  const d = (raw ?? "").replace(/[:@].*/, "").replace(/\D/g, "");
  return /^55\d{2}9\d{8}$/.test(d) ? d.slice(0, 4) + d.slice(5) : d;
}
