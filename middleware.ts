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
  return NextResponse.next();
}
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
