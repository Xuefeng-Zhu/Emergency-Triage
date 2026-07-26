import {
  ArrowLeft,
  AudioLines,
  CheckCircle2,
  CircleAlert,
  Clock3,
  LockKeyhole,
  Mic,
  RotateCcw,
  ShieldCheck,
  Square,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import { getWhisperXStatus, transcribeWithWhisperX } from "./api";
import type { WhisperXResult, WhisperXStatus } from "./types";

const CHUNK_SECONDS = 3;
const MIN_CHUNK_SECONDS = 0.45;

type Phase = "idle" | "listening" | "stopping" | "complete";

interface LiveSegment extends WhisperXResult {
  id: number;
  captured_at_ms: number;
}

function formatMilliseconds(value: number) {
  const totalSeconds = value / 1000;
  if (totalSeconds < 10) return `${totalSeconds.toFixed(1)} s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.floor(totalSeconds % 60);
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function mergeBuffers(buffers: Float32Array[]) {
  const length = buffers.reduce((total, buffer) => total + buffer.length, 0);
  const merged = new Float32Array(length);
  let offset = 0;
  for (const buffer of buffers) {
    merged.set(buffer, offset);
    offset += buffer.length;
  }
  return merged;
}

function encodeWav(samples: Float32Array, sampleRate: number) {
  const bytesPerSample = 2;
  const buffer = new ArrayBuffer(44 + samples.length * bytesPerSample);
  const view = new DataView(buffer);
  const writeString = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1) {
      view.setUint8(offset + index, value.charCodeAt(index));
    }
  };

  writeString(0, "RIFF");
  view.setUint32(4, 36 + samples.length * bytesPerSample, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * bytesPerSample, true);
  view.setUint16(32, bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeString(36, "data");
  view.setUint32(40, samples.length * bytesPerSample, true);

  let offset = 44;
  for (const sample of samples) {
    const clamped = Math.max(-1, Math.min(1, sample));
    view.setInt16(
      offset,
      clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff,
      true,
    );
    offset += bytesPerSample;
  }
  return new Blob([buffer], { type: "audio/wav" });
}

export function WhisperXTest({ onBack }: { onBack: () => void }) {
  const [status, setStatus] = useState<WhisperXStatus | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [segments, setSegments] = useState<LiveSegment[]>([]);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [pendingChunks, setPendingChunks] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const stream = useRef<MediaStream | null>(null);
  const audioContext = useRef<AudioContext | null>(null);
  const sourceNode = useRef<MediaStreamAudioSourceNode | null>(null);
  const processorNode = useRef<ScriptProcessorNode | null>(null);
  const silentGain = useRef<GainNode | null>(null);
  const buffers = useRef<Float32Array[]>([]);
  const sampleRate = useRef(48000);
  const chunkTimer = useRef<number | null>(null);
  const clockTimer = useRef<number | null>(null);
  const startedAt = useRef(0);
  const chunkId = useRef(0);
  const transcriptionQueue = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    void getWhisperXStatus()
      .then(setStatus)
      .catch((caught) =>
        setError(caught instanceof Error ? caught.message : "API unavailable"),
      );
  }, []);

  const flushChunk = useCallback(() => {
    const captured = buffers.current;
    buffers.current = [];
    if (!captured.length) return;

    const samples = mergeBuffers(captured);
    const durationMs = (samples.length / sampleRate.current) * 1000;
    if (durationMs < MIN_CHUNK_SECONDS * 1000) return;

    const id = ++chunkId.current;
    const capturedAtMs = Date.now() - startedAt.current;
    const wav = encodeWav(samples, sampleRate.current);
    setPendingChunks((count) => count + 1);

    transcriptionQueue.current = transcriptionQueue.current
      .then(async () => {
        const result = await transcribeWithWhisperX(wav, `live-${id}.wav`);
        if (result.text.trim()) {
          setSegments((current) => [
            ...current,
            { ...result, id, captured_at_ms: capturedAtMs },
          ]);
        }
        setStatus((current) => (current ? { ...current, loaded: true } : current));
      })
      .catch((caught) => {
        setError(caught instanceof Error ? caught.message : "Transcription failed");
      })
      .finally(() => {
        setPendingChunks((count) => Math.max(0, count - 1));
      });
  }, []);

  const releaseMicrophone = useCallback(() => {
    if (chunkTimer.current !== null) window.clearInterval(chunkTimer.current);
    if (clockTimer.current !== null) window.clearInterval(clockTimer.current);
    chunkTimer.current = null;
    clockTimer.current = null;
    processorNode.current?.disconnect();
    sourceNode.current?.disconnect();
    silentGain.current?.disconnect();
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
    processorNode.current = null;
    sourceNode.current = null;
    silentGain.current = null;
  }, []);

  useEffect(() => {
    return () => {
      releaseMicrophone();
      void audioContext.current?.close();
    };
  }, [releaseMicrophone]);

  const startListening = async () => {
    setError(null);
    setSegments([]);
    setElapsedMs(0);
    setPendingChunks(0);
    buffers.current = [];
    chunkId.current = 0;
    transcriptionQueue.current = Promise.resolve();

    if (!navigator.mediaDevices?.getUserMedia) {
      setError(
        "Microphone access requires HTTPS or localhost. Open the console through the localhost SSH tunnel.",
      );
      return;
    }

    try {
      const nextStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
      const context = new AudioContext();
      const source = context.createMediaStreamSource(nextStream);
      const processor = context.createScriptProcessor(4096, 1, 1);
      const gain = context.createGain();
      gain.gain.value = 0;
      processor.onaudioprocess = (event) => {
        buffers.current.push(
          new Float32Array(event.inputBuffer.getChannelData(0)),
        );
      };
      source.connect(processor);
      processor.connect(gain);
      gain.connect(context.destination);

      stream.current = nextStream;
      audioContext.current = context;
      sourceNode.current = source;
      processorNode.current = processor;
      silentGain.current = gain;
      sampleRate.current = context.sampleRate;
      startedAt.current = Date.now();
      chunkTimer.current = window.setInterval(flushChunk, CHUNK_SECONDS * 1000);
      clockTimer.current = window.setInterval(
        () => setElapsedMs(Date.now() - startedAt.current),
        200,
      );
      setPhase("listening");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Microphone unavailable");
    }
  };

  const stopListening = async () => {
    setPhase("stopping");
    setElapsedMs(Date.now() - startedAt.current);
    releaseMicrophone();
    flushChunk();
    await transcriptionQueue.current;
    await audioContext.current?.close();
    audioContext.current = null;
    setPhase("complete");
  };

  const reset = () => {
    releaseMicrophone();
    setSegments([]);
    setElapsedMs(0);
    setPendingChunks(0);
    setError(null);
    setPhase("idle");
  };

  const totalAudioMs = segments.reduce(
    (total, segment) => total + segment.duration_ms,
    0,
  );
  const totalProcessingMs = segments.reduce(
    (total, segment) => total + segment.processing_ms,
    0,
  );
  const combinedTranscript = segments.map((segment) => segment.text).join(" ");
  const isActive = phase === "listening" || phase === "stopping";

  return (
    <main className="whisper-shell">
      <header className="whisper-header">
        <div className="brand">
          <span className="brand-mark">
            <ShieldCheck size={25} />
          </span>
          <span>Triage Local</span>
        </div>
        <button className="back-button" onClick={onBack}>
          <ArrowLeft size={17} /> Back to encounter
        </button>
        <div className="whisper-runtime">
          <span className={`runtime-dot ${status?.loaded ? "loaded" : ""}`} />
          <div>
            <strong>{status?.model ?? "large-v3-turbo"}</strong>
            <span>
              {status
                ? `${status.device.toUpperCase()} · ${status.compute_type} · ${status.loaded ? "loaded" : "cold"}`
                : "Checking runtime…"}
            </span>
          </div>
        </div>
      </header>

      <section className="whisper-intro">
        <div>
          <h1>Live WhisperX console</h1>
          <p>
            Speak naturally and watch local transcription arrive in short,
            ordered chunks.
          </p>
        </div>
        <div className="privacy-note">
          <LockKeyhole size={18} />
          <span>Microphone audio stays on this device</span>
        </div>
      </section>

      {error ? (
        <div className="whisper-error" role="alert">
          <CircleAlert size={18} /> {error}
        </div>
      ) : null}

      <div className="whisper-workspace live-workspace">
        <section className="whisper-source live-source">
          <div className="whisper-section-heading">
            <span>01</span>
            <div>
              <h2>Live microphone</h2>
              <p>
                {phase === "idle" && "Ready to listen"}
                {phase === "listening" && "Capturing a new chunk every 3 seconds"}
                {phase === "stopping" && "Finishing queued transcription"}
                {phase === "complete" && "Session complete"}
              </p>
            </div>
          </div>

          <div className={`live-mic ${isActive ? "active" : ""}`}>
            <div className="live-wave" aria-hidden>
              {Array.from({ length: 17 }, (_, index) => <i key={index} />)}
            </div>
            <span className="live-timer">
              <Clock3 size={16} />
              {formatMilliseconds(elapsedMs)}
            </span>
            <strong>
              {phase === "idle" && "Start a live transcription"}
              {phase === "listening" && "Listening…"}
              {phase === "stopping" && "Finishing…"}
              {phase === "complete" && "Recording stopped"}
            </strong>
            <p>
              {phase === "idle"
                ? "The first words may take longer while large-v3-turbo loads."
                : `${pendingChunks} chunk${pendingChunks === 1 ? "" : "s"} waiting or processing`}
            </p>
            <button
              className={`live-control ${phase === "listening" ? "stop" : ""}`}
              onClick={phase === "listening" ? stopListening : startListening}
              disabled={phase === "stopping"}
            >
              {phase === "listening" ? <Square size={21} /> : <Mic size={23} />}
              {phase === "listening" ? "Stop & finish" : "Start listening"}
            </button>
          </div>

          <div className="live-notes">
            <div><span>1</span><p>Allow microphone access in your browser.</p></div>
            <div><span>2</span><p>Speak in phrases longer than a few words.</p></div>
            <div><span>3</span><p>Results append every {CHUNK_SECONDS} seconds after warm-up.</p></div>
          </div>
        </section>

        <section className="whisper-output live-output">
          <div className="whisper-section-heading">
            <span>02</span>
            <div>
              <h2>Live transcript</h2>
              <p>
                {segments.length
                  ? `${segments.length} completed chunk${segments.length === 1 ? "" : "s"}`
                  : "Results will appear while you speak"}
              </p>
            </div>
          </div>

          {!segments.length ? (
            <div className="output-empty">
              <AudioLines size={45} />
              <strong>
                {phase === "listening" || phase === "stopping"
                  ? "Listening for speech…"
                  : "Ready for your voice"}
              </strong>
              <p>
                Start the microphone and speak. WhisperX will append each
                non-empty chunk here.
              </p>
            </div>
          ) : (
            <div className="live-results">
              <div className="result-success">
                <CheckCircle2 size={19} />
                <span>{isActive ? "Transcribing on the Dell GPU" : "Transcription complete"}</span>
              </div>
              <div className="live-transcript" aria-live="polite">
                {segments.map((segment) => (
                  <article key={segment.id}>
                    <time>{formatMilliseconds(segment.captured_at_ms)}</time>
                    <p>{segment.text}</p>
                    <small>{formatMilliseconds(segment.processing_ms)} processing</small>
                  </article>
                ))}
                {isActive ? <span className="live-caret" aria-label="Listening" /> : null}
              </div>
              <dl className="result-metrics">
                <div>
                  <dt>Captured speech</dt>
                  <dd>{formatMilliseconds(totalAudioMs)}</dd>
                </div>
                <div>
                  <dt>GPU processing</dt>
                  <dd>{formatMilliseconds(totalProcessingMs)}</dd>
                </div>
                <div>
                  <dt>Words</dt>
                  <dd>{combinedTranscript.trim().split(/\s+/).filter(Boolean).length}</dd>
                </div>
              </dl>
              {phase === "complete" ? (
                <button className="reset-action" onClick={reset}>
                  <RotateCcw size={16} /> Start another session
                </button>
              ) : null}
            </div>
          )}
        </section>
      </div>

      <footer className="whisper-footer">
        <span><ShieldCheck size={16} /> Native runtime · No Docker</span>
        <span>
          WhisperX · {status?.language.toUpperCase() ?? "EN"} · {CHUNK_SECONDS}s chunks
        </span>
      </footer>
    </main>
  );
}
