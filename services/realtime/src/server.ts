import { createServer } from "node:http";
import { URL } from "node:url";
import { z } from "zod";
import WebSocket, { WebSocketServer } from "ws";
import { RecordingState } from "./recording-state";

const port = Number(process.env.REALTIME_PORT ?? 3001);
const dataRoot = process.env.DATA_ROOT_CONTAINER ?? process.env.DATA_ROOT ?? "/data";
const webUrl = process.env.INTERNAL_WEB_URL ?? "http://web:3000";
const serviceToken = process.env.INTERNAL_SERVICE_TOKEN;
const states = new Map<string, RecordingState>();
const pathSchema = z.string().uuid();

const server = createServer(async (request, response) => {
  if (request.url === "/health/live") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        status: "ok",
        service: "realtime",
        activeRecordings: states.size,
      }),
    );
    return;
  }
  if (request.url === "/health/ready") {
    let liveAsr = "unavailable";
    try {
      const upstream = await fetch(
        process.env.WHISPERLIVEKIT_HEALTH_URL ??
          "http://whisperlivekit:8000/",
        { signal: AbortSignal.timeout(2_000) },
      );
      liveAsr = upstream.ok ? "ok" : "degraded";
    } catch {
      liveAsr = "unavailable";
    }
    const ready = liveAsr === "ok";
    response.writeHead(ready ? 200 : 503, {
      "content-type": "application/json",
    });
    response.end(
      JSON.stringify({
        status: ready ? "ready" : "not_ready",
        service: "realtime",
        liveAsr,
        activeRecordings: states.size,
      }),
    );
    return;
  }
  response.writeHead(404).end();
});

const websocketServer = new WebSocketServer({ noServer: true });
const authorizedSockets = new WeakMap<
  WebSocket,
  { userId: string; recordingId: string }
>();

async function authorize(
  recordingId: string,
  cookie: string | undefined,
): Promise<{ userId: string; recordingId: string } | null> {
  if (!serviceToken) throw new Error("INTERNAL_SERVICE_TOKEN is required");
  const response = await fetch(
    `${webUrl}/api/internal/ws-authorize?recordingId=${encodeURIComponent(recordingId)}`,
    {
      headers: {
        "x-internal-service-token": serviceToken,
        cookie: cookie ?? "",
      },
      signal: AbortSignal.timeout(5_000),
    },
  );
  if (!response.ok) return null;
  return (await response.json()) as { userId: string; recordingId: string };
}

server.on("upgrade", async (request, socket, head) => {
  try {
    const url = new URL(request.url ?? "/", "http://localhost");
    const match = /^\/ws\/recordings\/([^/]+)$/.exec(url.pathname);
    const recordingId = match?.[1];
    if (!recordingId || !pathSchema.safeParse(recordingId).success) {
      socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
      socket.destroy();
      return;
    }
    const authorized = await authorize(recordingId, request.headers.cookie);
    if (!authorized) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }
    websocketServer.handleUpgrade(request, socket, head, (websocket) => {
      authorizedSockets.set(websocket, authorized);
      websocketServer.emit("connection", websocket, request);
    });
  } catch {
    socket.write("HTTP/1.1 503 Service Unavailable\r\n\r\n");
    socket.destroy();
  }
});

websocketServer.on(
  "connection",
  (websocket: WebSocket) => {
    const authorized = authorizedSockets.get(websocket);
    if (!authorized) {
      websocket.close(1008, "authorization missing");
      return;
    }
    let state = states.get(authorized.recordingId);
    if (!state) {
      state = new RecordingState({
        recordingId: authorized.recordingId,
        ownerId: authorized.userId,
        dataRoot,
        onSettled: () => states.delete(authorized.recordingId),
      });
      states.set(authorized.recordingId, state);
    }
    state.attach(websocket);
    websocket.on("message", (data, isBinary) => {
      if (isBinary) state?.handleAudio(Buffer.from(data as Buffer));
      else {
        try {
          state?.handleText(String(data));
        } catch {
          websocket.close(1007, "invalid control message");
        }
      }
    });
    websocket.on("close", () => state?.detach());
  },
);

server.listen(port, "0.0.0.0", () => {
  console.info(
    JSON.stringify({
      level: "info",
      service: "realtime",
      message: "listening",
      port,
    }),
  );
});

function shutdown(signal: string) {
  console.info(
    JSON.stringify({ level: "info", service: "realtime", signal }),
  );
  websocketServer.clients.forEach((client) =>
    client.close(1012, "service restart"),
  );
  server.close(() => process.exit(0));
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
