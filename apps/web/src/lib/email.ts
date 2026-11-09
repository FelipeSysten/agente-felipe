import "server-only";
import nodemailer from "nodemailer";

interface Mail {
  to: string;
  subject: string;
  html: string;
}

/**
 * Envia e-mail transacional.
 * - Gmail (SMTP + senha de app), se GMAIL_USER e GMAIL_APP_PASSWORD existirem:
 *   entrega para qualquer destinatário, até ~500/dia.
 * - Senão, Resend. Com o remetente de teste onboarding@resend.dev, o Resend só
 *   entrega para o e-mail dono da conta Resend.
 */
export async function sendEmail({ to, subject, html }: Mail): Promise<{ provider: "gmail" | "resend" }> {
  const gmailUser = process.env.GMAIL_USER;
  const gmailPass = process.env.GMAIL_APP_PASSWORD?.replace(/\s/g, ""); // o Google mostra a senha com espaços

  if (gmailUser && gmailPass) {
    const transport = nodemailer.createTransport({
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
      auth: { user: gmailUser, pass: gmailPass },
      connectionTimeout: 10_000,
    });
    await transport.sendMail({ from: `Agente Felipe <${gmailUser}>`, to, subject, html });
    return { provider: "gmail" };
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from: process.env.AUTH_EMAIL_FROM ?? "onboarding@resend.dev", to, subject, html }),
  });
  if (!res.ok) throw new Error(`Resend ${res.status} ${await res.text()}`);
  return { provider: "resend" };
}
