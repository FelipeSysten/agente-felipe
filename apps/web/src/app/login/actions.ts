"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { loginWithPassword, sendMagicLink } from "@/lib/auth";
import { createSessionToken, SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth/session";
import { checkRateLimit } from "@/lib/redis";
import { logError } from "@/lib/log";

export type LoginState = { ok: boolean; message: string } | null;

export async function requestLink(_prev: LoginState, form: FormData): Promise<LoginState> {
  const email = z.email().safeParse(String(form.get("email") ?? "").trim());
  if (!email.success) return { ok: false, message: "E-mail inválido" };
  try {
    await sendMagicLink(email.data);
  } catch (err) {
    logError("auth.request_failed", err);
    return { ok: false, message: "Não consegui enviar o e-mail agora. Tente de novo." };
  }
  return { ok: true, message: "Se esse e-mail tiver acesso, o link chega em instantes. Confira a caixa de entrada." };
}

export async function passwordLogin(_prev: LoginState, form: FormData): Promise<LoginState> {
  const login = String(form.get("login") ?? "").trim().toLowerCase();
  const password = String(form.get("password") ?? "");
  if (!login || !password) return { ok: false, message: "Preencha o login e a senha" };
  // 5 tentativas por minuto para cada login: segura quem tenta adivinhar a senha
  if (!(await checkRateLimit(`login:${login}`, 5))) {
    return { ok: false, message: "Muitas tentativas. Espere um minuto e tente de novo." };
  }
  const email = await loginWithPassword(login, password);
  if (!email) return { ok: false, message: "Login ou senha incorretos" };
  (await cookies()).set(SESSION_COOKIE, await createSessionToken(email), sessionCookieOptions);
  redirect("/dashboard");
}
