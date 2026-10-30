import { handleLocalRequest } from "../../../apps/server/src/next-route";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = handleLocalRequest;
export const POST = handleLocalRequest;
export const PUT = handleLocalRequest;
export const DELETE = handleLocalRequest;
