"use client";

import type {
  MeetingBrief,
  RecordingStatus,
  RealtimeServerEvent,
  TranscriptSegment,
} from "@emergency-trial/contracts";
import {
  millisecondsToTimestamp,
  realtimeServerEventSchema,
} from "@emergency-trial/contracts";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

interface WorkspaceUser {
  id: string;
  name: string;
  email: string;
  role: string;
}

interface InitialRecording {
  id: string;
  title: string;
  status: RecordingStatus;
  durationMs: number;
  segments: TranscriptSegment[];
  analyses: Array<{
    id: string;
    kind: string;
    status: string;
    markdown: string | null;
    result: Record<string, unknown> | null;
  }>;
}

const demoSegments: TranscriptSegment[] = [
  {
    startMs: 1_078_000,
    endMs: 1_083_000,
    speaker: "Jordan Lee",
    text: "Thanks everyone for joining on short notice. Let’s start with a quick status update on the situation.",
    words: [],
  },
  {
    startMs: 1_083_000,
    endMs: 1_090_000,
    speaker: "Taylor Kim",
    text: "We’ve confirmed the incident affects the eastern region. Services remain degraded.",
    words: [],
  },
  {
    startMs: 1_090_000,
    endMs: 1_096_000,
    speaker: "Morgan Patel",
    text: "The response teams are mobilizing now. ETA for full deployment is 30 minutes.",
    words: [],
  },
  {
    startMs: 1_096_000,
    endMs: 1_101_000,
    speaker: "Jordan Lee",
    text: "Do we have an update on customer communications?",
    words: [],
  },
  {
    startMs: 1_101_000,
    endMs: 1_107_000,
    speaker: "Casey Nguyen",
    text: "A draft notification is ready. We’ll send it once leadership approves.",
    words: [],
  },
  {
    startMs: 1_107_000,
    endMs: 1_113_000,
    speaker: "Riley Chen",
    text: "Potential for call center overload. We should activate overflow routing.",
    words: [],
  },
];

const demoBrief: MeetingBrief = {
  summary:
    "The response team is coordinating an eastern-region service incident and preparing customer communications.",
  keyPoints: [],
  decisions: [
    { text: "Activate call-center overflow routing.", atMs: 1_107_000 },
  ],
  actionItems: [
    {
      task: "Send the customer notification after leadership approval.",
      owner: "Casey Nguyen",
      due: null,
      atMs: 1_101_000,
    },
  ],
  risks: [
    { text: "Call-center demand may exceed capacity.", atMs: 1_107_000 },
  ],
  notableQuotes: [],
};

function Icon({
  name,
  size = 20,
}: {
  name: "wave" | "mic" | "team" | "lock" | "settings" | "chevron";
  size?: number;
}) {
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
  if (name === "wave")
    return (
      <svg {...common}>
        <path d="M4 10v4M8 6v12M12 3v18M16 7v10M20 10v4" />
      </svg>
    );
  if (name === "mic")
    return (
      <svg {...common}>
        <rect x="9" y="3" width="6" height="11" rx="3" />
        <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3M9 21h6" />
      </svg>
    );
  if (name === "team")
    return (
      <svg {...common}>
        <circle cx="9" cy="8" r="3" />
        <circle cx="17" cy="10" r="2.5" />
        <path d="M3.5 20a5.5 5.5 0 0 1 11 0M14 16a4.5 4.5 0 0 1 6.5 4" />
      </svg>
    );
  if (name === "lock")
    return (
      <svg {...common}>
        <rect x="5" y="10" width="14" height="11" rx="2" />
        <path d="M8 10V7a4 4 0 0 1 8 0v3" />
      </svg>
    );
  if (name === "settings")
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="3" />
        <path d="M19 14.5l1.2 1.8-2 2-1.8-1.2a7 7 0 0 1-2 .8L14 20h-4l-.4-2.1a7 7 0 0 1-2-.8l-1.8 1.2-2-2L5 14.5a7 7 0 0 1-.8-2L2 12V9l2.2-.5a7 7 0 0 1 .8-2L3.8 4.7l2-2L7.6 4a7 7 0 0 1 2-.8L10 1h4l.4 2.2a7 7 0 0 1 2 .8l1.8-1.3 2 2L19 6.5a7 7 0 0 1 .8 2L22 9v3l-2.2.5a7 7 0 0 1-.8 2Z" />
      </svg>
    );
  return (
    <svg {...common}>
      <path d="m8 10 4 4 4-4" />
    </svg>
  );
}

function Waveform({ active }: { active: boolean }) {
  const bars = useMemo(
    () =>
      Array.from({ length: 120 }, (_, index) => {
        const height =
          12 +
          Math.abs(Math.sin(index * 1.7) * 26) +
          Math.abs(Math.cos(index * 0.37) * 14);
        return Math.round(height);
      }),
    [],
  );
  return (
    <div className="waveform" aria-label="Audio waveform">
      <div className="waveform-bars">
        {bars.map((height, index) => (
          <span
            className={active ? "wave-bar active" : "wave-bar"}
            key={index}
            style={{ height }}
          />
        ))}
      </div>
      <div className="waveform-axis">
        {["00:00", "00:03", "00:06", "00:09", "00:12", "00:15", "00:18"].map(
          (label) => (
            <span key={label}>{label}</span>
          ),
        )}
      </div>
    </div>
  );
}

function BriefSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <details className="brief-section" open>
      <summary>
        {title}
        <Icon name="chevron" size={16} />
      </summary>
      <div>{children}</div>
    </details>
  );
}

export function WorkspaceShell({
  user,
  initialRecording,
  preview = false,
}: {
  user: WorkspaceUser;
  initialRecording: InitialRecording | null;
  preview?: boolean;
}) {
  const [recordingId, setRecordingId] = useState<string | null>(
    initialRecording?.id ?? (preview ? "99f06759-46d5-4443-a9b8-2266911fe86f" : null),
  );
  const [status, setStatus] = useState<RecordingStatus>(
    initialRecording?.status ?? (preview ? "recording" : "ready"),
  );
  const [elapsedMs, setElapsedMs] = useState(
    initialRecording?.durationMs ?? (preview ? 1_122_000 : 0),
  );
  const [segments, setSegments] = useState<TranscriptSegment[]>(
    initialRecording?.segments.length
      ? initialRecording.segments
      : preview
        ? demoSegments
        : [],
  );
  const [partial, setPartial] = useState("");
  const [captionsAvailable, setCaptionsAvailable] = useState(true);
  const [brief, setBrief] = useState<MeetingBrief | null>(
    preview ? null : ((initialRecording?.analyses[0]?.result as MeetingBrief) ?? null),
  );
  const [customPrompt, setCustomPrompt] = useState("");
  const [notice, setNotice] = useState("");
  const [pending, setPending] = useState(false);
  const socketRef = useRef<WebSocket | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const lastSequenceRef = useRef(0);
  const stoppingRef = useRef(false);
  const reconnectDeadlineRef = useRef(0);

  const isRecording = status === "recording";

  useEffect(() => {
    if (!isRecording || preview) return;
    const timer = window.setInterval(
      () => setElapsedMs((value) => value + 1_000),
      1_000,
    );
    return () => window.clearInterval(timer);
  }, [isRecording, preview]);

  const handleEvent = useCallback((event: RealtimeServerEvent) => {
    if (event.type === "partial_caption") setPartial(event.text);
    if (event.type === "committed_caption") {
      setSegments((current) => [...current, event.segment]);
      setPartial("");
    }
    if (event.type === "recording_status") setStatus(event.status);
    if (event.type === "finalization_queued") {
      stoppingRef.current = true;
      setStatus("finalizing");
      setNotice("Final transcript queued");
    }
    if (event.type === "error") {
      if (event.code === "LIVE_ASR_UNAVAILABLE") setCaptionsAvailable(false);
      setNotice(event.message);
    }
  }, []);

  function connectRealtime(path: string, mediaStream: MediaStream): void {
    const scheme = window.location.protocol === "https:" ? "wss:" : "ws:";
    const socket = new WebSocket(`${scheme}//${window.location.host}${path}`);
    socket.binaryType = "arraybuffer";
    socketRef.current = socket;
    socket.onmessage = (message) => {
      if (typeof message.data !== "string") return;
      let payload: unknown;
      try {
        payload = JSON.parse(message.data);
      } catch {
        setNotice("Realtime gateway returned an invalid event");
        return;
      }
      const parsed = realtimeServerEventSchema.safeParse(payload);
      if (!parsed.success) {
        setNotice("Realtime gateway returned an invalid event");
        return;
      }
      lastSequenceRef.current = Math.max(
        lastSequenceRef.current,
        parsed.data.sequence,
      );
      handleEvent(parsed.data);
    };
    socket.onopen = async () => {
      reconnectDeadlineRef.current = 0;
      socket.send(
        JSON.stringify(
          audioContextRef.current
            ? { type: "resume", lastSequence: lastSequenceRef.current }
            : {
                type: "start",
                sampleRate: 16_000,
                encoding: "pcm_s16le",
              },
        ),
      );
      if (audioContextRef.current) return;
      try {
        const context = new AudioContext();
        await context.audioWorklet.addModule("/audio-worklet.js");
        const source = context.createMediaStreamSource(mediaStream);
        const processor = new AudioWorkletNode(context, "pcm16-encoder");
        processor.port.onmessage = ({
          data,
        }: MessageEvent<ArrayBuffer>) => {
          if (socketRef.current?.readyState === WebSocket.OPEN) {
            socketRef.current.send(data);
          }
        };
        source.connect(processor);
        processor.connect(context.destination);
        audioContextRef.current = context;
      } catch {
        setNotice("Microphone audio processing could not start");
        stoppingRef.current = true;
        socket.close();
      }
    };
    socket.onerror = () => {
      setCaptionsAvailable(false);
      setNotice("Live captions unavailable — recording continues");
    };
    socket.onclose = () => {
      if (stoppingRef.current) return;
      const now = Date.now();
      if (reconnectDeadlineRef.current === 0) {
        reconnectDeadlineRef.current = now + 10_000;
      }
      if (now < reconnectDeadlineRef.current) {
        window.setTimeout(() => connectRealtime(path, mediaStream), 1_000);
      } else {
        setStatus("interrupted");
        setNotice("Recording interrupted after the reconnect window expired");
      }
    };
  }

  async function startRecording() {
    if (preview) {
      setStatus("recording");
      setElapsedMs(0);
      setSegments([]);
      setBrief(null);
      return;
    }
    setPending(true);
    setNotice("");
    stoppingRef.current = false;
    lastSequenceRef.current = 0;
    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      const response = await fetch("/api/recordings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: `Recording ${new Date().toLocaleString()}` }),
      });
      if (!response.ok) {
        mediaStream.getTracks().forEach((track) => track.stop());
        throw new Error("Could not create recording");
      }
      const created = (await response.json()) as {
        id: string;
        websocketPath: string;
      };
      mediaStreamRef.current = mediaStream;
      connectRealtime(created.websocketPath, mediaStream);
      setRecordingId(created.id);
      setStatus("recording");
      setElapsedMs(0);
      setSegments([]);
      setBrief(null);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Recording failed");
    } finally {
      setPending(false);
    }
  }

  async function stopRecording() {
    if (preview) {
      setStatus("finalizing");
      setNotice("Final transcript queued");
      window.setTimeout(() => {
        setStatus("ready");
        setBrief(demoBrief);
        setNotice("Final transcript and meeting brief are ready");
      }, 900);
      return;
    }
    stoppingRef.current = true;
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    await audioContextRef.current?.close();
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify({ type: "stop" }));
    }
    setStatus("finalizing");
  }

  async function submitAnalysis(event: React.FormEvent) {
    event.preventDefault();
    if (!customPrompt.trim() || !recordingId) return;
    if (preview) {
      setNotice("Custom analysis queued");
      setCustomPrompt("");
      return;
    }
    const response = await fetch(`/api/recordings/${recordingId}/analyses`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "custom", prompt: customPrompt }),
    });
    setNotice(response.ok ? "Custom analysis queued" : "Could not queue analysis");
    if (response.ok) setCustomPrompt("");
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <Link className="brand-lockup" href="/workspace">
          Emergency Trial
        </Link>
        <div className="user-menu">
          <span className="avatar">
            {user.name
              .split(" ")
              .map((part) => part[0])
              .slice(0, 2)
              .join("")}
          </span>
          <span>{user.name}</span>
          <Icon name="chevron" size={16} />
          {user.role === "admin" ? (
            <Link className="icon-button" href="/admin" aria-label="Settings">
              <Icon name="settings" />
            </Link>
          ) : null}
        </div>
      </header>

      <aside className="side-nav">
        <nav aria-label="Primary">
          <Link className="nav-item selected" href="/workspace">
            <Icon name="wave" /> Recordings
          </Link>
          <button className="nav-item" type="button" onClick={startRecording}>
            <Icon name="mic" /> New recording
          </button>
          <Link className="nav-item" href={user.role === "admin" ? "/admin" : "#"}>
            <Icon name="team" /> Team
          </Link>
        </nav>
        <span className="nav-foot">Private workspace</span>
      </aside>

      <main className="recording-main">
        <div className="recording-heading">
          <div>
            <h1>{isRecording ? "Live recording" : "Recording workspace"}</h1>
            <div className="timer-row">
              <span className={isRecording ? "record-dot active" : "record-dot"} />
              <time>{millisecondsToTimestamp(elapsedMs)}</time>
            </div>
          </div>
          {isRecording ? (
            <button className="stop-button" type="button" onClick={stopRecording}>
              <span className="stop-square" /> Stop recording
            </button>
          ) : (
            <button
              className="start-button"
              disabled={pending}
              type="button"
              onClick={startRecording}
            >
              <Icon name="mic" size={18} />
              {pending ? "Preparing…" : "Start recording"}
            </button>
          )}
          <div className="secure-state">
            <Icon name="lock" size={19} /> Secure live session
          </div>
        </div>

        <Waveform active={isRecording} />

        <section className="transcript-section">
          <div className="section-title-row">
            <h2>Provisional transcript</h2>
            {!captionsAvailable ? (
              <span className="caption-warning">
                Live captions unavailable — recording continues
              </span>
            ) : null}
          </div>
          <div className="transcript-list" aria-live="polite">
            {segments.length === 0 ? (
              <div className="empty-transcript">
                {isRecording
                  ? "Listening for speech…"
                  : "Start a recording to see live captions here."}
              </div>
            ) : null}
            {segments.map((segment, index) => (
              <div className="transcript-row" key={`${segment.startMs}-${index}`}>
                <time>{millisecondsToTimestamp(segment.startMs)}</time>
                <strong>{segment.speaker ?? "Speaker"}</strong>
                <p>{segment.text}</p>
              </div>
            ))}
            {partial ? (
              <div className="transcript-row partial">
                <time>{millisecondsToTimestamp(elapsedMs)}</time>
                <strong>Live</strong>
                <p>{partial}</p>
              </div>
            ) : null}
            {isRecording ? (
              <div className="transcript-row system-row">
                <time>{millisecondsToTimestamp(elapsedMs)}</time>
                <strong>System</strong>
                <p>Recording in progress…</p>
              </div>
            ) : null}
          </div>
          <p className="privacy-note">
            <Icon name="lock" size={16} /> Audio and transcripts stay on this
            host and are available only to their owner.
          </p>
        </section>
      </main>

      <aside className="analysis-rail">
        <h2>Meeting brief</h2>
        <div className="brief-panel">
          <BriefSection title="Summary">
            <p>
              {brief?.summary ??
                "Not available yet. Stop the recording to generate."}
            </p>
          </BriefSection>
          <BriefSection title="Decisions">
            <p>
              {brief?.decisions[0]?.text ??
                "Not available yet. Stop the recording to generate."}
            </p>
          </BriefSection>
          <BriefSection title="Action items">
            <p>
              {brief?.actionItems[0]?.task ??
                "Not available yet. Stop the recording to generate."}
            </p>
          </BriefSection>
          <BriefSection title="Risks">
            <p>
              {brief?.risks[0]?.text ??
                "Not available yet. Stop the recording to generate."}
            </p>
          </BriefSection>
        </div>

        <form className="analysis-form" onSubmit={submitAnalysis}>
          <label htmlFor="custom-prompt">Ask about this recording</label>
          <textarea
            id="custom-prompt"
            value={customPrompt}
            onChange={(event) => setCustomPrompt(event.target.value)}
            maxLength={4_000}
            placeholder="Type your question…"
          />
          <div>
            <span>{customPrompt.length} / 4000</span>
            <button
              type="submit"
              disabled={!customPrompt.trim() || status !== "ready"}
            >
              Ask
            </button>
          </div>
        </form>

        <section className="queue-panel">
          <div className="queue-tabs">
            <strong>Final transcript</strong>
            <span>Agent analysis</span>
          </div>
          <div className="queue-row">
            <span className={`queue-spinner ${status}`} />
            <div>
              <strong>
                {status === "ready"
                  ? "Ready"
                  : status === "finalizing"
                    ? "Processing"
                    : "Queued"}
              </strong>
              <p>
                {status === "ready"
                  ? "Authoritative transcript is available."
                  : "Will be ready after you stop the recording."}
              </p>
            </div>
          </div>
          <div className="queue-row">
            <span className={`queue-spinner ${brief ? "ready" : ""}`} />
            <div>
              <strong>{brief ? "Ready" : "Not started"}</strong>
              <p>Agent analysis begins after the final transcript is ready.</p>
            </div>
          </div>
        </section>
        {notice ? <output className="workspace-notice">{notice}</output> : null}
      </aside>
    </div>
  );
}
