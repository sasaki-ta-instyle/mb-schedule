import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { isAuthEnabled, isAuthorizedAsync } from "@/lib/auth";

export async function middleware(req: NextRequest) {
  if (!isAuthEnabled()) return NextResponse.next();
  const method = req.method.toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
    return NextResponse.next();
  }
  const path = req.nextUrl.pathname;
  // 認証エンドポイント自体はクッキー発行のために通す
  if (
    path === "/api/auth/edit-check" ||
    path.endsWith("/api/auth/edit-check")
  ) {
    return NextResponse.next();
  }
  if (!(await isAuthorizedAsync(req))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/api/:path*"],
  runtime: "nodejs",
};
