export const runtime = "nodejs";

export function GET() {
  return Response.json({
    status: "ok",
    service: "web",
    timestamp: new Date().toISOString(),
  });
}
