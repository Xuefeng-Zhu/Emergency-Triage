import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface AgentAdapter {
  analyze(input: {
    analysisId: string;
    prompt: string;
    files: Array<{ name: string; contents: string }>;
  }): Promise<string>;
  unload(): Promise<void>;
}

function collectText(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(collectText);
  if (!value || typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  const direct =
    typeof record.text === "string" &&
    ["assistant", "message", "output_text"].includes(String(record.type ?? ""))
      ? [record.text]
      : [];
  return [...direct, ...Object.values(record).flatMap(collectText)];
}

export function extractAgentText(stdout: string): string {
  const trimmed = stdout.trim();
  if (!trimmed) throw new Error("NemoClaw returned an empty response");
  try {
    const parsed: unknown = JSON.parse(trimmed);
    const texts = collectText(parsed).filter((value) => value.trim().length > 0);
    return texts.at(-1) ?? trimmed;
  } catch {
    return trimmed;
  }
}

export class NemoClawAdapter implements AgentAdapter {
  readonly #sandbox = process.env.NEMOCLAW_SANDBOX ?? "emergency-trial-agent";
  readonly #agent = process.env.NEMOCLAW_AGENT_ID ?? "transcript-analyst";
  readonly #workRoot = path.resolve(
    process.env.AGENT_WORK_ROOT ?? "/var/lib/emergency-trial/agent-jobs",
  );
  readonly #timeoutMs = Number(process.env.AGENT_TIMEOUT_MS ?? 900_000);
  readonly #model = process.env.OLLAMA_MODEL ?? "qwen3.5:9b";

  async analyze(input: {
    analysisId: string;
    prompt: string;
    files: Array<{ name: string; contents: string }>;
  }): Promise<string> {
    if (!/^[0-9a-f-]{36}$/i.test(input.analysisId)) {
      throw new Error("Unsafe analysis id");
    }
    const localDirectory = path.join(this.#workRoot, input.analysisId);
    const remoteDirectory = `/sandbox/.openclaw/workspace-${this.#agent}/jobs/${input.analysisId}`;
    const sessionId = `analysis-${input.analysisId}-${randomUUID().slice(0, 8)}`;
    await mkdir(localDirectory, { recursive: true, mode: 0o700 });

    try {
      await this.#runNemoClaw([
        this.#sandbox,
        "exec",
        "--",
        "mkdir",
        "-p",
        remoteDirectory,
      ]);
      for (const file of input.files) {
        if (!/^[a-z0-9._-]+$/i.test(file.name)) {
          throw new Error("Unsafe agent input filename");
        }
        const localPath = path.join(localDirectory, file.name);
        const remotePath = `${remoteDirectory}/${file.name}`;
        await writeFile(localPath, file.contents, { mode: 0o600 });
        await this.#runNemoClaw([
          this.#sandbox,
          "upload",
          localPath,
          remotePath,
        ]);
      }
      const { stdout } = await this.#runNemoClaw([
        this.#sandbox,
        "agent",
        "--agent",
        this.#agent,
        "--session-id",
        sessionId,
        "--timeout",
        String(Math.ceil(this.#timeoutMs / 1_000)),
        "--json",
        "-m",
        input.prompt,
      ]);
      return extractAgentText(stdout);
    } finally {
      await this.#runNemoClaw([
        this.#sandbox,
        "sessions",
        "delete",
        sessionId,
        "--agent",
        this.#agent,
        "--json",
      ]).catch(() => undefined);
      await this.#runNemoClaw([
        this.#sandbox,
        "exec",
        "--",
        "rm",
        "-rf",
        remoteDirectory,
      ]).catch(() => undefined);
      await rm(localDirectory, { recursive: true, force: true });
    }
  }

  async unload(): Promise<void> {
    await execFileAsync("ollama", ["stop", this.#model], {
      timeout: 30_000,
      maxBuffer: 1024 * 1024,
    }).catch(() => undefined);
  }

  async #runNemoClaw(args: string[]) {
    return execFileAsync("nemoclaw", args, {
      timeout: this.#timeoutMs,
      maxBuffer: 10 * 1024 * 1024,
      env: { ...process.env, NO_COLOR: "1" },
    });
  }
}

export class FakeAgentAdapter implements AgentAdapter {
  async analyze(input: { prompt: string }): Promise<string> {
    if (input.prompt.includes("meetingBrief")) {
      return JSON.stringify({
        summary: "Test summary",
        keyPoints: [{ text: "Point", atMs: 0, speaker: null }],
        decisions: [],
        actionItems: [],
        risks: [],
        notableQuotes: [],
      });
    }
    return "## Test analysis\n\nEvidence appears at [00:00:00].";
  }

  async unload(): Promise<void> {}
}
