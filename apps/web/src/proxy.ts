import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth/session";

// Checagem otimista (só assinatura do cookie). A autorização real
// (e-mail na ADMIN_EMAILS) acontece no requireUser() de cada página/ação.
export async function proxy(req: NextRequest) {
  const email = await verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value);
  if (!email) return NextResponse.redirect(new URL("/login", req.url));
  return NextResponse.next();
}

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/conversations/:path*",
    "/agents/:path*",
    "/onboarding/:path*",
    "/settings/:path*",
    "/learning/:path*",
  ],
};
