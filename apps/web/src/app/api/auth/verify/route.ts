import { NextResponse } from "next/server";
import { consumeMagicToken } from "@/lib/auth";
import { createSessionToken, SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth/session";
import { logEvent } from "@/lib/log";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const token = url.searchParams.get("token");
  const email = token ? await consumeMagicToken(token) : null;
  if (!email) {
    logEvent("auth.verify_failed");
    return NextResponse.redirect(new URL("/login?erro=link", url));
  }
  const res = NextResponse.redirect(new URL("/dashboard", url));
  res.cookies.set(SESSION_COOKIE, await createSessionToken(email), sessionCookieOptions);
  logEvent("auth.login_ok");
  return res;
}
