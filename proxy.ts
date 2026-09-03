import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { SESSION_COOKIE, verifyToken } from "@/lib/auth/token";

// Public: marketing, legal, sign-in/sign-up, guide, webhooks.
const PUBLIC_PREFIXES = [
  "/connexion",
  "/inscription",
  "/guide",
  "/mentions-legales",
  "/cgu",
  "/confidentialite",
  "/hors-ligne",
  "/acces-refuse",
  "/api/stripe/webhook",
  "/api/pos/zelty",
  "/api/health",
  "/manifest.webmanifest",
  "/sw.js",
  "/icons",
];

function isPublic(pathname: string): boolean {
  if (pathname === "/") return true;
  return PUBLIC_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

// First line of defence: the cookie must carry a VALID signature (a forged
// or expired token is rejected before any page code runs) and the role in
// the token must be allowed on that area of the app. Fine-grained checks
// (which site, which tenant, account still active) happen in
// lib/session.ts against the database.
export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (isPublic(pathname)) return NextResponse.next();

  const payload = await verifyToken(request.cookies.get(SESSION_COOKIE)?.value, "session");
  if (!payload) {
    const url = new URL("/connexion", request.url);
    if (pathname !== "/") url.searchParams.set("suite", pathname);
    const response = NextResponse.redirect(url);
    response.cookies.delete(SESSION_COOKIE);
    return response;
  }

  const role = payload.role;
  const forbidden = () => NextResponse.redirect(new URL("/acces-refuse", request.url));

  if (pathname.startsWith("/admin") && role !== "superadmin") return forbidden();
  if (pathname.startsWith("/direction") && role !== "director") return forbidden();
  if (pathname.startsWith("/s/")) {
    if (role === "superadmin") return forbidden();
    // Staff are pinned to their own site — the URL's siteId must match the
    // token's. Directors may open any site (tenant check happens server-side).
    const siteId = pathname.split("/")[2];
    if (role !== "director" && payload.sid !== siteId) {
      return NextResponse.redirect(new URL(`/s/${payload.sid}`, request.url));
    }
    // Kitchen and stock screens are for cooks + directors; the service and
    // till screens for waiters + directors.
    const section = pathname.split("/")[3] ?? "";
    if (role === "waiter" && (section === "cuisine" || section === "stock")) return forbidden();
    if (role === "cook" && (section === "service" || section === "commande" || section === "caisse")) return forbidden();
  }
  if (pathname.startsWith("/api/kds") && role === "waiter") return forbidden();
  if (pathname.startsWith("/api/orders") && role === "cook") return forbidden();
  if (pathname.startsWith("/api/stock") && role === "waiter") return forbidden();

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|svg|ico|jpg|jpeg|webp)$).*)"],
};
