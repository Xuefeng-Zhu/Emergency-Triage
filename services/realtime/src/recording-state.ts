import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  mkdir,
  open,
  readFile,
  rm,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import { spawn } from "node:child_process";
import {
  realtimeClientMessageSchema,
  safeRecordingRelativePath,
  type RealtimeServerEvent,
  type TranscriptSegment,
} from "@emergency-trial/contracts";
import {
  db,
  jobs,
  recordingChunks,
  recordings,
  transcripts,
} from "@emergency-trial/db";
import { and, asc, eq } from "drizzle-orm";
import WebSocket from "ws";
import { parseLiveAsrMessage } from "./live-asr";

const SAMPLE_RATE = 16_000;
const BYTES_PER_SECOND = SAMPLE_RATE * 2;
const CHUNK_BYTES = BYTES_PER_SECOND * 5;
export const RECONNECT_GRACE_MS = 10_000;

function sha256(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

async function sha256File(path: string): Promise<string> {
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(path)) digest.update(chunk);
  return digest.digest("hex");
}

function run(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "ignore", "pipe"],
    });
    let errorOutput = "";
    child.stderr.on("data", (chunk) => {
      errorOutput += String(chunk).slice(0, 2_000);
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited ${code}: ${errorOutput}`));
    });
  });
}

export class RecordingState {
  readonly recordingId: string;
  readonly ownerId: string;
  private readonly dataRoot: string;
  private socket: WebSocket | null = null;
  private liveAsr: WebSocket | null = null;
  private chunkParts: Buffer[] = [];
  private chunkBytes = 0;
  private sequence = 0;
  private receivedBytes = 0;
  private eventSequence = 0;
  private operation = Promise.resolve();
  private disconnectTimer: NodeJS.Timeout | null = null;
  private stopped = false;
  private readonly onSettled: () => void;

  constructor(input: {
    recordingId: string;
    ownerId: string;
    dataRoot: string;
    onSettled: () => void;
  }) {
    this.recordingId = input.recordingId;
    this.ownerId = input.ownerId;
    this.dataRoot = input.dataRoot;
    this.onSettled = input.onSettled;
  }

  attach(socket: WebSocket): void {
    if (this.disconnectTimer) clearTimeout(this.disconnectTimer);
    this.disconnectTimer = null;
    this.socket = socket;
    this.send({
      type: "ready",
      recordingId: this.recordingId,
      sequence: this.nextEventSequence(),
      reconnectGraceMs: RECONNECT_GRACE_MS,
    });
    this.connectLiveAsr();
  }

  handleText(text: string): void {
    const parsed = realtimeClientMessageSchema.safeParse(JSON.parse(text));
    if (!parsed.success) {
      this.sendError("INVALID_MESSAGE", "Invalid realtime control message", false);
      return;
    }
    if (parsed.data.type === "stop") {
      this.operation = this.operation.then(() => this.finalize()).catch((error) => {
        this.fail(error, "FINALIZATION_FAILED");
      });
    } else if (
      parsed.data.type === "start" ||
      parsed.data.type === "resume"
    ) {
      this.send({
        type: "recording_status",
        recordingId: this.recordingId,
        sequence: this.nextEventSequence(),
        status: "recording",
      });
    } else if (parsed.data.type === "ping") {
      this.send({
        type: "pong",
        recordingId: this.recordingId,
        sequence: this.nextEventSequence(),
        sentAt: parsed.data.sentAt,
      });
    }
  }

  handleAudio(data: Buffer): void {
    if (this.stopped || data.byteLength === 0) return;
    this.liveAsr?.readyState === WebSocket.OPEN && this.liveAsr.send(data);
    this.chunkParts.push(data);
    this.chunkBytes += data.byteLength;
    this.receivedBytes += data.byteLength;
    if (this.chunkBytes >= CHUNK_BYTES) {
      this.operation = this.operation.then(() => this.flushChunk());
    }
  }

  detach(): void {
    this.socket = null;
    if (this.stopped) return;
    this.disconnectTimer = setTimeout(() => {
      this.operation = this.operation
        .then(async () => {
          await this.flushChunk();
          await db
            .update(recordings)
            .set({ status: "interrupted", updatedAt: new Date() })
            .where(eq(recordings.id, this.recordingId));
          this.onSettled();
        })
        .catch((error) => this.fail(error, "INTERRUPT_SAVE_FAILED"));
    }, RECONNECT_GRACE_MS);
  }

  private connectLiveAsr(): void {
    if (
      !process.env.WHISPERLIVEKIT_URL ||
      process.env.LIVE_ASR_DISABLED === "true" ||
      this.liveAsr
    ) {
      return;
    }
    const upstream = new WebSocket(process.env.WHISPERLIVEKIT_URL);
    upstream.on("open", () => {
      upstream.send(
        JSON.stringify({
          type: "config",
          sample_rate: SAMPLE_RATE,
          encoding: "pcm_s16le",
          language: "auto",
        }),
      );
    });
    upstream.on("message", (data) => {
      const caption = parseLiveAsrMessage(
        String(data),
        Math.round((this.receivedBytes / BYTES_PER_SECOND) * 1_000),
      );
      if (!caption) return;
      if (caption.committed) {
        const segment = {
          startMs: caption.startMs,
          endMs: caption.endMs,
          text: caption.text,
          speaker: caption.speaker ?? null,
          words: [],
        };
        this.send({
          type: "committed_caption",
          recordingId: this.recordingId,
          sequence: this.nextEventSequence(),
          segment,
        });
        this.operation = this.operation
          .then(() => this.persistProvisional(segment))
          .catch(() =>
            this.sendError(
              "CAPTION_PERSIST_FAILED",
              "Live caption storage unavailable — recording continues",
              true,
            ),
          );
      } else {
        this.send({
          type: "partial_caption",
          recordingId: this.recordingId,
          sequence: this.nextEventSequence(),
          text: caption.text,
          startMs: caption.startMs,
          endMs: caption.endMs,
        });
      }
    });
    upstream.on("error", () => {
      this.sendError(
        "LIVE_ASR_UNAVAILABLE",
        "Live captions unavailable — recording continues",
        true,
      );
    });
    upstream.on("close", () => {
      this.liveAsr = null;
    });
    this.liveAsr = upstream;
  }

  private async persistProvisional(segment: TranscriptSegment): Promise<void> {
    const existing = await db.query.transcripts.findFirst({
      where: and(
        eq(transcripts.recordingId, this.recordingId),
        eq(transcripts.kind, "provisional"),
      ),
    });
    const segments = [...(existing?.segments ?? []), segment];
    const text = segments.map((item) => item.text).join(" ");
    await db
      .insert(transcripts)
      .values({
        recordingId: this.recordingId,
        kind: "provisional",
        text,
        segments,
        model: process.env.WHISPERLIVEKIT_MODEL ?? "small",
      })
      .onConflictDoUpdate({
        target: [transcripts.recordingId, transcripts.kind],
        set: { text, segments, updatedAt: new Date() },
      });
  }

  private async flushChunk(): Promise<void> {
    if (this.chunkBytes === 0) return;
    const buffer = Buffer.concat(this.chunkParts, this.chunkBytes);
    this.chunkParts = [];
    this.chunkBytes = 0;
    const filename = `chunk-${String(this.sequence).padStart(6, "0")}.pcm`;
    const relative = safeRecordingRelativePath(
      this.ownerId,
      this.recordingId,
      filename,
    );
    const path = join(this.dataRoot, relative);
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    await writeFile(path, buffer, { mode: 0o600 });
    await db.insert(recordingChunks).values({
      recordingId: this.recordingId,
      sequence: this.sequence,
      path,
      sha256: sha256(buffer),
      bytes: buffer.byteLength,
      durationMs: Math.round((buffer.byteLength / BYTES_PER_SECOND) * 1_000),
    });
    this.sequence += 1;
  }

  private async finalize(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    if (this.disconnectTimer) clearTimeout(this.disconnectTimer);
    await this.flushChunk();
    this.liveAsr?.close();

    const chunks = await db.query.recordingChunks.findMany({
      where: eq(recordingChunks.recordingId, this.recordingId),
      orderBy: [asc(recordingChunks.sequence)],
    });
    if (chunks.length === 0) throw new Error("No audio was captured");
    const directory = dirname(chunks[0]?.path ?? this.dataRoot);
    const rawPath = join(directory, "source.pcm");
    const flacPath = join(directory, "source.flac");
    const rawFile = await open(rawPath, "w", 0o600);
    let rawBytes = 0;
    try {
      for (const [expectedSequence, chunk] of chunks.entries()) {
        if (chunk.sequence !== expectedSequence) {
          throw new Error(
            `Chunk sequence gap: expected ${expectedSequence}, received ${chunk.sequence}`,
          );
        }
        const data = await readFile(chunk.path);
        if (sha256(data) !== chunk.sha256) {
          throw new Error(`Chunk checksum mismatch at sequence ${chunk.sequence}`);
        }
        await rawFile.write(data);
        rawBytes += data.byteLength;
      }
    } finally {
      await rawFile.close();
    }
    await run("ffmpeg", [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-f",
      "s16le",
      "-ar",
      String(SAMPLE_RATE),
      "-ac",
      "1",
      "-i",
      rawPath,
      "-c:a",
      "flac",
      flacPath,
    ]);
    const [flacInfo, flacSha256] = await Promise.all([
      stat(flacPath),
      sha256File(flacPath),
    ]);
    const durationMs = Math.round((rawBytes / BYTES_PER_SECOND) * 1_000);

    const job = await db.transaction(async (tx) => {
      await tx
        .update(recordings)
        .set({
          status: "finalizing",
          audioPath: flacPath,
          audioSha256: flacSha256,
          audioBytes: flacInfo.size,
          durationMs,
          recordingStoppedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(recordings.id, this.recordingId));
      const [queued] = await tx
        .insert(jobs)
        .values({
          idempotencyKey: `finalize:${this.recordingId}`,
          type: "whisperx_finalize",
          recordingId: this.recordingId,
          ownerId: this.ownerId,
        })
        .onConflictDoUpdate({
          target: jobs.idempotencyKey,
          set: { status: "queued", availableAt: new Date(), updatedAt: new Date() },
        })
        .returning({ id: jobs.id });
      await tx
        .delete(recordingChunks)
        .where(eq(recordingChunks.recordingId, this.recordingId));
      return queued;
    });
    if (!job) throw new Error("Finalization job was not created");

    await Promise.allSettled([
      unlink(rawPath),
      ...chunks.map((chunk) => unlink(chunk.path)),
    ]);
    this.send({
      type: "finalization_queued",
      recordingId: this.recordingId,
      sequence: this.nextEventSequence(),
      jobId: job.id,
    });
    this.socket?.close(1000, "finalization queued");
    this.onSettled();
  }

  async destroy(): Promise<void> {
    this.liveAsr?.close();
    const directory = join(
      this.dataRoot,
      safeRecordingRelativePath(
        this.ownerId,
        this.recordingId,
        "placeholder",
      ),
      "..",
    );
    await rm(directory, { recursive: true, force: true });
  }

  private send(event: RealtimeServerEvent): void {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(event));
    }
  }

  private sendError(code: string, message: string, retryable: boolean): void {
    this.send({
      type: "error",
      recordingId: this.recordingId,
      sequence: this.nextEventSequence(),
      code,
      message,
      retryable,
    });
  }

  private fail(error: unknown, code: string): void {
    const message = error instanceof Error ? error.message : String(error);
    this.sendError(code, message, false);
    void db
      .update(recordings)
      .set({
        status: "failed",
        failureCode: code,
        failureMessage: message.slice(0, 2_000),
        updatedAt: new Date(),
      })
      .where(eq(recordings.id, this.recordingId));
    this.onSettled();
  }

  private nextEventSequence(): number {
    const sequence = this.eventSequence;
    this.eventSequence += 1;
    return sequence;
  }
}
