import { NextResponse, type NextRequest } from "next/server";
/** The local host boundary also protects server-rendered project pages. */
export function middleware(request: NextRequest) {
  const host = request.headers.get("host");
  if (!host || !/^(?:localhost|127\.0\.0\.1):\d+$/.test(host))
    return new NextResponse("Local host required", { status: 403 });
  const origin = request.headers.get("origin");
  if (origin && origin !== `http://${host}`)
    return new NextResponse("Cross-origin requests are not allowed", {
      status: 403,
    });
  if (request.headers.get("sec-fetch-site") === "cross-site")
    return new NextResponse("Cross-site requests are not allowed", {
      status: 403,
    });
  const headers = new Headers(request.headers),
    locale = request.nextUrl.pathname.split("/")[1];
  headers.set(
    "x-harness-locale",
    ["en", "zh", "es", "fr", "de", "it", "pt", "ja", "ko"].includes(locale)
      ? locale
      : "en",
  );
  return NextResponse.next({ request: { headers } });
}
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
