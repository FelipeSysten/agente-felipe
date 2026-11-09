import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { sendEmail } from "@/lib/email";
import { adminEmails, appUrl } from "@/lib/settings";
import { logError, logEvent } from "@/lib/log";
import { SESSION_COOKIE, verifySessionToken } from "./session";
import { verifyPassword } from "./password";

const TOKEN_TTL_MIN = 15;

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

/** Admin = e-mail da ADMIN_EMAILS ou cadastrado em Ajustes → Acesso ao painel. */
export async function isAdmin(email: string): Promise<boolean> {
  if (adminEmails().includes(email)) return true;
  return (await prisma.adminUser.count({ where: { email } })) > 0;
}

/** Data Access Layer: toda página/ação do painel passa por aqui. */
export async function requireUser(): Promise<string> {
  const email = await verifySessionToken((await cookies()).get(SESSION_COOKIE)?.value);
  if (!email || !(await isAdmin(email))) redirect("/login");
  return email;
}

/** Login e senha. Aceita o login ("felipe") ou o e-mail. Retorna o e-mail se a senha confere. */
export async function loginWithPassword(rawLogin: string, password: string): Promise<string | null> {
  const login = rawLogin.trim().toLowerCase();
  const user = await prisma.adminUser.findFirst({ where: { OR: [{ username: login }, { email: login }] } });
  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    logEvent("auth.password_failed");
    return null;
  }
  await prisma.adminUser.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  logEvent("auth.password_ok");
  return user.email;
}

/**
 * Envia o magic link. Sempre "sucesso" p/ o cliente (não revela quais e-mails são admin).
 */
export async function sendMagicLink(rawEmail: string): Promise<void> {
  const email = rawEmail.trim().toLowerCase();
  if (!(await isAdmin(email))) {
    logEvent("auth.magic_link_denied");
    return;
  }

  const token = randomBytes(32).toString("base64url");
  await prisma.loginToken.create({
    data: {
      email,
      tokenHash: sha256(token),
      expiresAt: new Date(Date.now() + TOKEN_TTL_MIN * 60_000),
    },
  });

  const link = `${appUrl()}/api/auth/verify?token=${token}`;
  try {
    const { provider } = await sendEmail({
      to: email,
      subject: "Seu link de acesso — Agente Felipe",
      html: `<p>Clique para entrar no painel (válido por ${TOKEN_TTL_MIN} min):</p>
<p><a href="${link}">Entrar no painel</a></p>
<p style="color:#71717a">Se não foi você, ignore este e-mail.</p>`,
    });
    logEvent("auth.magic_link_sent", { provider });
  } catch (err) {
    logError("auth.magic_link_send_failed", err);
    throw new Error("Falha ao enviar e-mail");
  }
}

/** Consome o token (uso único). Retorna o e-mail se válido. */
export async function consumeMagicToken(token: string): Promise<string | null> {
  const row = await prisma.loginToken.findUnique({ where: { tokenHash: sha256(token) } });
  if (!row || row.usedAt || row.expiresAt < new Date()) return null;
  // updateMany com usedAt=null garante uso único mesmo com 2 cliques simultâneos
  const { count } = await prisma.loginToken.updateMany({
    where: { id: row.id, usedAt: null },
    data: { usedAt: new Date() },
  });
  return count === 1 ? row.email : null;
}
