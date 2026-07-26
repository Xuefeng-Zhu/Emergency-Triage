import {
  AudioLines,
  Ban,
  Check,
  ChevronDown,
  CircleAlert,
  ClipboardList,
  FileText,
  LockKeyhole,
  Mic,
  MonitorCheck,
  Plus,
  ShieldCheck,
  Sparkles,
  Square,
  Stethoscope,
  UserRound,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import {
  createSession,
  decideProposal,
  getSession,
  requestConsult,
  sendUtterance,
} from "./api";
import type { Proposal, Session } from "./types";
import { WhisperXTest } from "./WhisperXTest";

const NURSES = [
  { id: "rn-alex", name: "RN Alex Morgan" },
  { id: "rn-jordan", name: "RN Jordan Lee" },
];

type RecordingPhase = "idle" | "starting" | "recording" | "processing";

function timeLabel(timestamp: string) {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(timestamp));
}

function AppHeader({
  session,
  nurseIndex,
  onNurseChange,
  onNew,
  onWhisperXTest,
}: {
  session: Session | null;
  nurseIndex: number;
  onNurseChange: (value: number) => void;
  onNew: () => void;
  onWhisperXTest: () => void;
}) {
  return (
    <header className="app-header">
      <div className="brand">
        <span className="brand-mark">
          <ShieldCheck size={25} />
        </span>
        <span>Triage Local</span>
      </div>
      <div className="encounter">
        <span>Encounter</span>
        <strong>{session?.session_id.slice(-8).toUpperCase() ?? "Starting…"}</strong>
      </div>
      <div className="system-state" aria-label="System state">
        <span><MonitorCheck size={17} /> Local processing</span>
        <span><LockKeyhole size={16} /> Egress blocked</span>
      </div>
      <label className="nurse-select">
        <UserRound size={18} />
        <select
          aria-label="Nurse identity"
          value={nurseIndex}
          onChange={(event) => onNurseChange(Number(event.target.value))}
        >
          {NURSES.map((nurse, index) => (
            <option value={index} key={nurse.id}>
              {nurse.name}
            </option>
          ))}
        </select>
        <ChevronDown size={16} aria-hidden />
      </label>
      <button className="whisper-link" onClick={onWhisperXTest}>
        <AudioLines size={17} /> WhisperX test
      </button>
      <button className="primary compact" onClick={onNew}>
        <Plus size={17} /> New encounter
      </button>
    </header>
  );
}

function TranscriptPanel({
  session,
  busy,
  recordingPhase,
  onRecord,
}: {
  session: Session | null;
  busy: boolean;
  recordingPhase: RecordingPhase;
  onRecord: () => void;
}) {
  const isRecording = recordingPhase === "recording";
  const recordingCopy = {
    idle: ["Start recording", "Tap to begin speaking"],
    starting: ["Starting microphone…", "Allow browser access if prompted"],
    recording: ["Stop recording", "Tap when you are finished"],
    processing: ["Processing locally…", "WhisperX is transcribing"],
  }[recordingPhase];

  return (
    <section className="panel transcript-panel">
      <div className="panel-title">
        <FileText size={19} />
        <h2>Transcript</h2>
      </div>
      <div className="transcript-list" aria-live="polite">
        {session?.transcript.length ? (
          session.transcript.map((item) => (
            <article className="utterance" key={item.utterance_id}>
              <div className={`speaker-avatar ${item.speaker}`}>
                {item.speaker === "nurse" ? "N" : "P"}
              </div>
              <div>
                <div className="utterance-meta">
                  <strong>{item.speaker === "nurse" ? "Nurse" : "Patient"}</strong>
                  <time>{timeLabel(item.created_at)}</time>
                </div>
                <p>{item.text}</p>
              </div>
            </article>
          ))
        ) : (
          <div className="empty-copy">
            Begin the encounter with one push-to-talk utterance.
          </div>
        )}
      </div>
      <button
        type="button"
        className={`talk-button ${isRecording ? "recording" : ""}`}
        onClick={onRecord}
        disabled={!session || (busy && !isRecording)}
        aria-label={recordingCopy[0]}
        aria-pressed={isRecording}
      >
        <span className="mic-orbit">
          {isRecording ? <Square size={25} fill="currentColor" /> : <Mic size={31} />}
        </span>
        <strong>{recordingCopy[0]}</strong>
        <span>{recordingCopy[1]}</span>
      </button>
    </section>
  );
}

function SuggestionsPanel({ session }: { session: Session | null }) {
  const label =
    session?.suggestions.pathway_node.replaceAll("_", " ").replace(".", " — ") ??
    "intake";
  return (
    <section className="panel suggestions-panel">
      <div className="panel-title">
        <CircleAlert size={19} />
        <h2>Suggested next questions</h2>
      </div>
      <div className="pathway-state">
        <div>
          <span>Current pathway</span>
          <strong>{label}</strong>
        </div>
        <span className="node-label">Pathway state</span>
      </div>
      <div className="questions">
        {session?.suggestions.questions.map((question, index) => (
          <article className="question" key={question.id}>
            <span className="question-number">{index + 1}</span>
            <div>
              <h3>{question.text}</h3>
              <p>{question.rationale}</p>
            </div>
          </article>
        ))}
      </div>
      <div className="advisory-note">
        <CircleAlert size={18} />
        <span>
          Suggestions are generated locally and are not clinical directives. You
          remain the decision-maker.
        </span>
      </div>
    </section>
  );
}

function ProposalCard({
  proposal,
  busy,
  onDecision,
}: {
  proposal: Proposal;
  busy: boolean;
  onDecision: (proposal: Proposal, decision: "approve" | "deny") => void;
}) {
  if (proposal.status === "refused") {
    return (
      <article className="proposal refused">
        <Ban size={27} />
        <div>
          <div className="proposal-heading">
            <h3>{proposal.label}</h3>
            <strong>Refused by policy</strong>
          </div>
          <p>{proposal.policy_reason}</p>
          <small>{proposal.test_code} · {proposal.citation}</small>
        </div>
      </article>
    );
  }

  return (
    <article className="proposal">
      <Stethoscope size={24} />
      <div>
        <div className="proposal-heading">
          <h3>{proposal.label}</h3>
          <strong className={`status ${proposal.status}`}>{proposal.status}</strong>
        </div>
        <p>{proposal.rationale}</p>
        <small>{proposal.test_code} · {proposal.citation}</small>
        {proposal.status === "proposed" ? (
          <div className="proposal-actions">
            <button
              className="approve"
              disabled={busy}
              onClick={() => onDecision(proposal, "approve")}
            >
              <Check size={16} /> Approve
            </button>
            <button
              className="deny"
              disabled={busy}
              onClick={() => onDecision(proposal, "deny")}
            >
              <X size={16} /> Deny
            </button>
          </div>
        ) : null}
      </div>
    </article>
  );
}

function ConsultPanel({
  session,
  busy,
  onConsult,
  onDecision,
}: {
  session: Session | null;
  busy: boolean;
  onConsult: () => void;
  onDecision: (proposal: Proposal, decision: "approve" | "deny") => void;
}) {
  return (
    <section className="panel consult-panel">
      <div className="panel-title">
        <ClipboardList size={19} />
        <h2>Consult &amp; governed orders</h2>
      </div>
      <div className="consult-scroll">
        <button
          className="consult-button"
          disabled={!session || busy}
          onClick={onConsult}
        >
          <Sparkles size={18} />
          {busy ? "Running local consult…" : "Request consult"}
        </button>
        <div className="section-label">Test proposals</div>
        <div className="proposal-list">
          {session?.proposals.length ? (
            session.proposals.map((proposal) => (
              <ProposalCard
                key={proposal.proposal_id}
                proposal={proposal}
                busy={busy}
                onDecision={onDecision}
              />
            ))
          ) : (
            <div className="empty-copy compact-empty">
              Proposals appear only after an explicit consult request.
            </div>
          )}
        </div>
        <div className="section-label audit-label">Audit trail</div>
        <div className="audit-list">
          {session?.audit.slice().reverse().map((entry) => (
            <div className="audit-row" key={entry.audit_id}>
              <time>{timeLabel(entry.ts)}</time>
              <span>{entry.actor}</span>
              <span>{entry.action.replaceAll("_", " ")}</span>
              <strong>{entry.outcome}</strong>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export function App() {
  const [showWhisperXTest, setShowWhisperXTest] = useState(
    () => window.location.pathname === "/whisperx",
  );
  const [session, setSession] = useState<Session | null>(null);
  const [nurseIndex, setNurseIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [recordingPhase, setRecordingPhase] =
    useState<RecordingPhase>("idle");
  const [error, setError] = useState<string | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const recordingStream = useRef<MediaStream | null>(null);
  const recordingPhaseRef = useRef<RecordingPhase>("idle");
  const chunks = useRef<Blob[]>([]);
  const initialized = useRef(false);

  const changeRecordingPhase = (phase: RecordingPhase) => {
    recordingPhaseRef.current = phase;
    setRecordingPhase(phase);
  };

  useEffect(() => {
    const handlePopState = () =>
      setShowWhisperXTest(window.location.pathname === "/whisperx");
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  const refresh = useCallback(async (sessionId: string) => {
    setSession(await getSession(sessionId));
  }, []);

  const startNew = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      setSession(await createSession());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not start session");
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    void startNew();
  }, [startNew]);

  useEffect(() => {
    return () => {
      const activeRecorder = recorder.current;
      if (activeRecorder) {
        activeRecorder.onstop = null;
        if (activeRecorder.state === "recording") activeRecorder.stop();
      }
      recordingStream.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  const toggleRecording = async () => {
    if (recordingPhaseRef.current === "recording") {
      changeRecordingPhase("processing");
      if (recorder.current?.state === "recording") recorder.current.stop();
      return;
    }
    if (recordingPhaseRef.current !== "idle" || busy) return;

    changeRecordingPhase("starting");
    setBusy(true);
    setError(null);
    try {
      if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
        throw new Error("This browser does not support microphone recording.");
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      recordingStream.current = stream;
      chunks.current = [];
      recorder.current = mediaRecorder;
      mediaRecorder.ondataavailable = (data) => {
        if (data.data.size > 0) chunks.current.push(data.data);
      };
      mediaRecorder.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop());
        recorder.current = null;
        recordingStream.current = null;
        changeRecordingPhase("processing");
        try {
          if (!session) throw new Error("The encounter is not ready.");
          const blob = new Blob(chunks.current, {
            type: mediaRecorder.mimeType || "audio/webm",
          });
          await sendUtterance(session.session_id, blob, "patient");
          await refresh(session.session_id);
        } catch (caught) {
          setError(caught instanceof Error ? caught.message : "Transcription failed");
        } finally {
          changeRecordingPhase("idle");
          setBusy(false);
        }
      };
      mediaRecorder.start();
      changeRecordingPhase("recording");
    } catch (caught) {
      recordingStream.current?.getTracks().forEach((track) => track.stop());
      recordingStream.current = null;
      recorder.current = null;
      changeRecordingPhase("idle");
      setBusy(false);
      setError(caught instanceof Error ? caught.message : "Microphone unavailable");
    }
  };

  const runConsult = async () => {
    if (!session) return;
    setBusy(true);
    setError(null);
    try {
      await requestConsult(session.session_id);
      await refresh(session.session_id);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Consult failed");
    } finally {
      setBusy(false);
    }
  };

  const decide = async (
    proposal: Proposal,
    decision: "approve" | "deny",
  ) => {
    if (!session) return;
    setBusy(true);
    setError(null);
    try {
      await decideProposal(proposal.proposal_id, decision, NURSES[nurseIndex]);
      await refresh(session.session_id);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Decision failed");
    } finally {
      setBusy(false);
    }
  };

  const openWhisperXTest = () => {
    window.history.pushState({}, "", "/whisperx");
    setShowWhisperXTest(true);
  };

  const closeWhisperXTest = () => {
    window.history.pushState({}, "", "/");
    setShowWhisperXTest(false);
  };

  if (showWhisperXTest) {
    return <WhisperXTest onBack={closeWhisperXTest} />;
  }

  return (
    <main className="app-shell">
      <AppHeader
        session={session}
        nurseIndex={nurseIndex}
        onNurseChange={setNurseIndex}
        onNew={startNew}
        onWhisperXTest={openWhisperXTest}
      />
      {error ? (
        <div className="error-banner" role="alert">
          <CircleAlert size={17} /> {error}
        </div>
      ) : null}
      <div className="workspace">
        <TranscriptPanel
          session={session}
          busy={busy}
          recordingPhase={recordingPhase}
          onRecord={() => void toggleRecording()}
        />
        <SuggestionsPanel session={session} />
        <ConsultPanel
          session={session}
          busy={busy}
          onConsult={runConsult}
          onDecision={decide}
        />
      </div>
      <footer>
        <span><ShieldCheck size={16} /> All processing stays on this device.</span>
        <span>Clinical decision support · Nurse approval required</span>
      </footer>
    </main>
  );
}
