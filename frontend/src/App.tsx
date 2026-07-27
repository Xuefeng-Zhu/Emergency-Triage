import { useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import './App.css'
import {
  createSession,
  decideProposal,
  getHealth,
  getSession,
  requestConsult,
  sendUtterance,
  sendUtteranceAudio,
  transcribeAudio,
} from './api'
import type { Proposal, Question, Session } from './types'

type NodeType = 'patient' | 'observation' | 'question' | 'diagnosis'
type Answer = 'yes' | 'no' | 'pending'

type GraphNode = {
  id: string
  x: number
  y: number
  r: number
  type: NodeType
  lines: string[]
  answer?: Answer
}

const LEVEL_Y = [34, 115, 205, 295, 385]

const graphNodes: GraphNode[] = [
  { id: 'patient', x: 140, y: LEVEL_Y[0], r: 26, type: 'patient', lines: ['John Doe', '54M'] },

  { id: 'chestPain', x: 70, y: LEVEL_Y[1], r: 24, type: 'observation', lines: ['Chest', 'Pain'] },
  { id: 'sob', x: 210, y: LEVEL_Y[1], r: 24, type: 'observation', lines: ['Short of', 'Breath'] },

  { id: 'onset', x: 40, y: LEVEL_Y[2], r: 21, type: 'question', lines: ['Onset', 'sudden?'], answer: 'yes' },
  { id: 'radiates', x: 100, y: LEVEL_Y[2], r: 21, type: 'question', lines: ['Radiates', 'to arm?'], answer: 'no' },
  { id: 'restExertion', x: 210, y: LEVEL_Y[2], r: 21, type: 'question', lines: ['Rest or', 'exertion?'], answer: 'yes' },

  { id: 'possibleACS', x: 25, y: LEVEL_Y[3], r: 21, type: 'diagnosis', lines: ['Possible', 'ACS'] },
  { id: 'cardiacOrigin', x: 70, y: LEVEL_Y[3], r: 19, type: 'diagnosis', lines: ['Cardiac', 'origin'] },

  { id: 'priorCardiac', x: 15, y: LEVEL_Y[4], r: 18, type: 'question', lines: ['Cardiac', 'hx?'], answer: 'pending' },
  { id: 'familyMI', x: 55, y: LEVEL_Y[4], r: 18, type: 'question', lines: ['Family', 'MI hx?'], answer: 'pending' },
]

const graphEdges: [string, string][] = [
  ['patient', 'chestPain'],
  ['patient', 'sob'],

  ['chestPain', 'onset'],
  ['chestPain', 'radiates'],
  ['sob', 'restExertion'],

  ['onset', 'possibleACS'],
  ['onset', 'cardiacOrigin'],

  ['possibleACS', 'priorCardiac'],
  ['possibleACS', 'familyMI'],
]

function SuggestionGraph() {
  const byId = Object.fromEntries(graphNodes.map((n) => [n.id, n]))

  return (
    <svg
      className="graph"
      viewBox="0 0 250 425"
      preserveAspectRatio="xMidYMin meet"
      role="img"
      aria-label="Suggestion graph"
    >
      {graphEdges.map(([fromId, toId]) => {
        const from = byId[fromId]
        const to = byId[toId]
        const answerClass = to.answer ? ` answer-${to.answer}` : ''
        return (
          <line
            key={`${fromId}-${toId}`}
            className={`edge${answerClass}`}
            x1={from.x}
            y1={from.y}
            x2={to.x}
            y2={to.y}
          />
        )
      })}

      {graphNodes.map((node) => {
        const lineOffset = (node.lines.length - 1) * 5
        return (
          <g key={node.id} className={`node ${node.type}`}>
            <circle cx={node.x} cy={node.y} r={node.r} />
            {node.lines.map((text, i) => (
              <text key={i} x={node.x} y={node.y - lineOffset + i * 10 + 3}>
                {text}
              </text>
            ))}
          </g>
        )
      })}
    </svg>
  )
}

// ---- Live wiring types shared by every screen ----

type Nurse = { id: string; name: string }

const NURSES: Nurse[] = [
  { id: 'rn-rivera', name: 'J. Rivera' },
  { id: 'rn-morgan', name: 'A. Morgan' },
]

type Speaker = 'nurse' | 'patient'
type InputMode = 'mic' | 'type'
type RecordingPhase = 'idle' | 'starting' | 'recording' | 'processing'

type LiveState = {
  session: Session | null
  loading: boolean
  error: string | null
}

type ScreenProps = {
  testDataMode: boolean
  presentationMode: boolean
  live: LiveState
  nurseIndex: number
  onNurseChange: (index: number) => void
  inputMode: InputMode
  onInputModeChange: (mode: InputMode) => void
  pathwayHistory: string[]
  onSendUtterance: (text: string, speaker: Speaker) => void
  onSendAudio: (blob: Blob, speaker: Speaker) => Promise<void>
  onRunConsult: () => void
  onDecision: (proposalId: string, decision: 'approve' | 'deny') => void
}

function sessionLabel(session: Session | null): string {
  return session ? session.session_id.slice(-8).toUpperCase() : 'Starting…'
}

function SessionInfoBar({ testDataMode, live, nurseIndex, onNurseChange }: ScreenProps) {
  if (testDataMode) {
    return (
      <section className="panel session-info">
        <span className="session-dot" />
        <span>SESSION #2291 · NURSE J. RIVERA · 08:42:15</span>
      </section>
    )
  }
  return (
    <section className="panel session-info">
      <span className="session-dot" />
      <span>
        SESSION #{sessionLabel(live.session)}
        {live.session ? ` · ${new Date(live.session.started_at).toLocaleTimeString()}` : ''}
        {' · NURSE'}
      </span>
      <select
        className="nurse-select"
        aria-label="Nurse identity"
        value={nurseIndex}
        onChange={(e) => onNurseChange(Number(e.target.value))}
      >
        {NURSES.map((nurse, index) => (
          <option key={nurse.id} value={index}>
            {nurse.name}
          </option>
        ))}
      </select>
    </section>
  )
}

function ScrollArrows({ targetRef }: { targetRef: RefObject<HTMLDivElement | null> }) {
  const scrollBy = (amount: number) => {
    targetRef.current?.scrollBy({ top: amount, behavior: 'smooth' })
  }
  return (
    <div className="scroll-arrows">
      <button className="scroll-arrow" type="button" aria-label="Scroll up" onClick={() => scrollBy(-80)}>
        &#9650;
      </button>
      <button className="scroll-arrow" type="button" aria-label="Scroll down" onClick={() => scrollBy(80)}>
        &#9660;
      </button>
    </div>
  )
}

// ---- Live suggestion graph: built from real session data ----

// "chest_pain.initial" → ["chest pain", "initial"]
function pathwayLines(node: string): string[] {
  return node
    .split('.')
    .map((part) => part.replaceAll('_', ' '))
    .slice(0, 2)
}

function LiveSuggestionGraph({
  pathwayHistory,
  questions,
  presentationMode,
}: {
  pathwayHistory: string[]
  questions: Question[]
  presentationMode: boolean
}) {
  const centerX = 125
  const levelGap = 78
  const patientY = 34
  const history = pathwayHistory.length > 0 ? pathwayHistory : ['intake']

  const pathNodes = history.map((node, i) => ({
    id: `path-${i}`,
    node,
    x: centerX,
    y: patientY + (i + 1) * levelGap,
  }))
  const current = pathNodes[pathNodes.length - 1]
  const questionY = current.y + levelGap
  const questionNodes = questions.map((q, i) => ({
    id: q.id,
    x: centerX + (i - (questions.length - 1) / 2) * 72,
    y: questionY,
  }))
  const height = (questions.length > 0 ? questionY : current.y) + 40
  const renderedHeight = height * 1.15 * (presentationMode ? 2 : 1)

  return (
    <>
      <svg
        className="graph live-graph"
        viewBox={`0 0 250 ${height}`}
        style={{ height: `${renderedHeight}px` }}
        preserveAspectRatio="xMidYMin meet"
        role="img"
        aria-label="Live suggestion graph"
      >
        {pathNodes.map((node, i) => (
          <line
            key={`edge-${node.id}`}
            className="edge"
            x1={centerX}
            y1={i === 0 ? patientY : pathNodes[i - 1].y}
            x2={node.x}
            y2={node.y}
          />
        ))}
        {questionNodes.map((node) => (
          <line
            key={`edge-${node.id}`}
            className="edge answer-pending"
            x1={current.x}
            y1={current.y}
            x2={node.x}
            y2={node.y}
          />
        ))}

        <g className="node patient">
          <circle cx={centerX} cy={patientY} r={26} />
          <text x={centerX} y={patientY + 3}>Patient</text>
        </g>
        {pathNodes.map((node) => {
          const lines = pathwayLines(node.node)
          const lineOffset = (lines.length - 1) * 5
          return (
            <g key={node.id} className="node observation">
              <circle cx={node.x} cy={node.y} r={24} />
              {lines.map((text, i) => (
                <text key={i} x={node.x} y={node.y - lineOffset + i * 10 + 3}>
                  {text}
                </text>
              ))}
            </g>
          )
        })}
        {questionNodes.map((node, i) => (
          <g key={node.id} className="node question">
            <circle cx={node.x} cy={node.y} r={18} />
            <text x={node.x} y={node.y + 3}>Q{i + 1}</text>
          </g>
        ))}
      </svg>
      {questions.length > 0 && (
        <ul className="graph-qlist">
          {questions.map((q, i) => (
            <li key={q.id}>
              <strong>Q{i + 1}</strong> {q.text}
              <br />
              <span className="citation">{q.rationale}</span>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}

function LiveVisitScreen(props: ScreenProps) {
  const { testDataMode, presentationMode, live, inputMode, onInputModeChange, onSendUtterance, onSendAudio, onRunConsult } = props
  const [draft, setDraft] = useState('')
  const [micSpeaker, setMicSpeaker] = useState<Speaker>('patient')
  const [phase, setPhase] = useState<RecordingPhase>('idle')
  const [micError, setMicError] = useState<string | null>(null)
  const [isRecording, setIsRecording] = useState(true)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const transcriptRef = useRef<HTMLDivElement>(null)
  const graphRef = useRef<HTMLDivElement>(null)

  // Stop the mic if the user navigates away mid-recording.
  useEffect(() => {
    return () => {
      const recorder = recorderRef.current
      if (recorder) {
        recorder.onstop = null
        if (recorder.state === 'recording') recorder.stop()
      }
      streamRef.current?.getTracks().forEach((track) => track.stop())
    }
  }, [])

  useEffect(() => {
    if (presentationMode && graphRef.current) {
      const el = graphRef.current
      el.scrollLeft = (el.scrollWidth - el.clientWidth) / 2
    }
  }, [presentationMode])

  const send = (speaker: Speaker) => {
    if (!draft.trim()) return
    onSendUtterance(draft, speaker)
    setDraft('')
  }

  const toggleRecording = async (speaker: Speaker) => {
    if (phase === 'recording') {
      if (recorderRef.current?.state === 'recording') recorderRef.current.stop()
      return
    }
    if (phase !== 'idle') return

    setPhase('starting')
    setMicError(null)
    try {
      if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
        throw new Error('This browser does not support microphone recording.')
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const recorder = new MediaRecorder(stream)
      streamRef.current = stream
      chunksRef.current = []
      recorderRef.current = recorder
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data)
      }
      recorder.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop())
        recorderRef.current = null
        streamRef.current = null
        setPhase('processing')
        try {
          const blob = new Blob(chunksRef.current, {
            type: recorder.mimeType || 'audio/webm',
          })
          await onSendAudio(blob, speaker)
        } finally {
          setPhase('idle')
        }
      }
      recorder.start()
      setPhase('recording')
    } catch (error) {
      streamRef.current?.getTracks().forEach((track) => track.stop())
      streamRef.current = null
      recorderRef.current = null
      setPhase('idle')
      setMicError((error as Error).message)
    }
  }

  const recordHint = {
    idle: 'Tap to record',
    starting: 'Starting microphone…',
    recording: 'Recording — tap to stop',
    processing: 'Transcribing locally…',
  }[phase]

  return (
    <div className="live-visit-grid">
      <div className="record-row">
        {testDataMode ? (
          <>
            <button
              className={`record-button${isRecording ? ' recording' : ''}`}
              aria-label="Toggle recording"
              onClick={() => setIsRecording((r) => !r)}
            />
            <span className="record-label">{isRecording ? 'Recording live' : 'Click to record'}</span>
          </>
        ) : (
          <>
            <div className="mode-switch" role="group" aria-label="Input mode">
              <button
                className={`mode-btn${inputMode === 'mic' ? ' active' : ''}`}
                onClick={() => onInputModeChange('mic')}
              >
                Mic
              </button>
              <button
                className={`mode-btn${inputMode === 'type' ? ' active' : ''}`}
                onClick={() => onInputModeChange('type')}
              >
                Type
              </button>
            </div>
            {inputMode === 'mic' && (
              <div className="mic-controls">
                <div className="mode-switch" role="group" aria-label="Speaker">
                  <button
                    className={`mode-btn${micSpeaker === 'patient' ? ' active' : ''}`}
                    disabled={phase === 'recording'}
                    onClick={() => setMicSpeaker('patient')}
                  >
                    Patient
                  </button>
                  <button
                    className={`mode-btn${micSpeaker === 'nurse' ? ' active' : ''}`}
                    disabled={phase === 'recording'}
                    onClick={() => setMicSpeaker('nurse')}
                  >
                    Nurse
                  </button>
                </div>
                <button
                  className={`record-button live ${phase}`}
                  aria-label={recordHint}
                  aria-pressed={phase === 'recording'}
                  disabled={phase === 'starting' || phase === 'processing'}
                  onClick={() => void toggleRecording(micSpeaker)}
                />
                <span className="record-hint">{recordHint}</span>
              </div>
            )}
          </>
        )}
      </div>

      <SessionInfoBar {...props} />

      <section className="panel transcript">
        <div className="card-header">
          <h2>Transcript</h2>
          <ScrollArrows targetRef={transcriptRef} />
        </div>
        {testDataMode ? (
          <div className="transcript-scroll" ref={transcriptRef}>
            <p className="line">
              <strong>Patient:</strong> I'm <span className="hl-patient">John Doe</span>, 54.
              Sudden, sharp <span className="hl-observation">chest pain</span>.
            </p>
            <p className="line">
              <strong>Nurse:</strong> Does it{' '}
              <span className="hl-question">radiate to your arm</span>?
            </p>
            <p className="line">
              <strong>Patient:</strong> No, just my chest.
            </p>
            <p className="line">
              <strong>Nurse:</strong> Any <span className="hl-observation">shortness of breath</span>?
            </p>
            <p className="line">
              <strong>Patient:</strong> Yes, worse <span className="hl-question">at rest</span>.
            </p>
            <p className="line">
              <strong>Agent:</strong> Suggests <span className="hl-diagnosis">possible ACS</span> —
              recommend ECG + troponin.
            </p>
            <p className="line">
              <strong>Nurse:</strong> Any <span className="hl-question">prior cardiac history</span>{' '}
              or <span className="hl-question">family MI history</span>?
            </p>
          </div>
        ) : (
          <>
            <div className="transcript-scroll" ref={transcriptRef}>
              {live.session && live.session.transcript.length > 0 ? (
                live.session.transcript.map((item) => (
                  <p className="line" key={item.utterance_id}>
                    <strong>{item.speaker === 'nurse' ? 'Nurse' : 'Patient'}:</strong>{' '}
                    {item.text}
                  </p>
                ))
              ) : (
                <p className="line">No utterances yet — send one below.</p>
              )}
            </div>
            {inputMode === 'type' && (
              <div className="compose-row">
                <input
                  type="text"
                  className="compose-input"
                  placeholder="Type what's said (echo STT mode)…"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                />
                <button
                  className="compose-btn"
                  disabled={!draft.trim() || live.loading}
                  onClick={() => send('patient')}
                >
                  Patient
                </button>
                <button
                  className="compose-btn"
                  disabled={!draft.trim() || live.loading}
                  onClick={() => send('nurse')}
                >
                  Nurse
                </button>
              </div>
            )}
            {(micError ?? live.error) && (
              <p className="live-error">{micError ?? live.error}</p>
            )}
          </>
        )}
      </section>

      <section className="panel choice">
        <div className="diagnosis-description">
          {testDataMode ? (
            <>
              <h2>Diagnosis Suggestion</h2>
              <p className="line">
                Acute chest pain, exertional onset. Recommend ECG + troponin panel given
                risk factors.
              </p>
            </>
          ) : (
            <>
              <h2>Diagnosis Suggestion</h2>
              <p className="line">
                {live.session?.suggestions.pathway_node ?? 'intake'}
              </p>
            </>
          )}
        </div>
        <div className="selection-buttons">
          {testDataMode ? (
            <>
              <button className="sel-btn check" aria-label="Approve">
                &#10003;
              </button>
              <button className="sel-btn neutral" aria-label="Neutral">
                &#9675;
              </button>
              <button className="sel-btn deny" aria-label="Deny">
                &#10005;
              </button>
            </>
          ) : (
            <button
              className="sel-btn consult"
              disabled={live.loading || !live.session}
              onClick={onRunConsult}
            >
              Run Consult
            </button>
          )}
        </div>
      </section>

      <section className="panel suggestions">
        <div className="suggestions-header">
          <h2>Suggestions</h2>
          <div className="suggestions-header-controls">
            {testDataMode && (
              <div className="legend">
                <span className="legend-item patient">Patient</span>
                <span className="legend-item observation">Observation</span>
                <span className="legend-item question">Question</span>
                <span className="legend-item diagnosis">Diagnosis</span>
              </div>
            )}
            <ScrollArrows targetRef={graphRef} />
          </div>
        </div>
        {testDataMode ? (
          <div className="graph-scroll" ref={graphRef}>
            <SuggestionGraph />
          </div>
        ) : (
          <div className="graph-scroll" ref={graphRef}>
            {live.session ? (
              <LiveSuggestionGraph
                pathwayHistory={props.pathwayHistory}
                questions={live.session.suggestions.questions}
                presentationMode={presentationMode}
              />
            ) : (
              <p className="line">No session yet.</p>
            )}
          </div>
        )}
      </section>
    </div>
  )
}

type StaticProposalCard = {
  id: string
  name: string
  rationale: string
  citation: string
  status: 'pending' | 'approved'
  precedent?: string
}

const staticProposals: StaticProposalCard[] = [
  {
    id: 'ecg',
    name: 'ECG',
    rationale: 'Rule out ischemic changes given chest pain with exertional component.',
    citation: 'Pathway: chest-pain-onset > ECG-first',
    status: 'approved',
  },
  {
    id: 'troponin',
    name: 'Troponin Panel',
    rationale: 'Serial troponin to evaluate for ACS given onset and risk profile.',
    citation: 'Pathway: possible-ACS > troponin-serial',
    status: 'pending',
    precedent: 'Auto-cleared: routine test, approved 3x previously',
  },
  {
    id: 'cxr',
    name: 'Chest X-ray',
    rationale: 'Baseline imaging to rule out alternate cardiopulmonary causes.',
    citation: 'Pathway: chest-pain > imaging-baseline',
    status: 'pending',
  },
]

function approverFor(session: Session, proposalId: string): string | null {
  const entry = [...session.audit]
    .reverse()
    .find((row) => row.proposal_id === proposalId && row.action === 'approve')
  return entry ? entry.actor : null
}

function LiveProposalCard({
  proposal,
  session,
  onDecision,
}: {
  proposal: Proposal
  session: Session
  onDecision: ScreenProps['onDecision']
}) {
  return (
    <section className="panel proposal-card">
      <div className="proposal-top">
        <span className="proposal-name">{proposal.label}</span>
        {(proposal.status === 'approved' || proposal.status === 'submitted') && (
          <span className="badge badge-approved">
            Approved by: {approverFor(session, proposal.proposal_id) ?? 'unknown'}
          </span>
        )}
        {proposal.status === 'denied' && <span className="badge badge-denied">Denied</span>}
        {proposal.status === 'refused' && <span className="badge badge-refused">Refused</span>}
      </div>
      <p className="line">{proposal.rationale}</p>
      <p className="citation">{proposal.citation}</p>
      {proposal.status === 'refused' && proposal.policy_reason && (
        <p className="citation">Policy: {proposal.policy_reason}</p>
      )}
      {proposal.status === 'proposed' && (
        <div className="big-decision-buttons">
          <button className="big-btn yes" onClick={() => onDecision(proposal.proposal_id, 'approve')}>
            Yes
          </button>
          <button className="big-btn no" onClick={() => onDecision(proposal.proposal_id, 'deny')}>
            No
          </button>
        </div>
      )}
    </section>
  )
}

function ApprovalScreen(props: ScreenProps) {
  const { testDataMode, live, onRunConsult } = props
  const proposals = live.session?.proposals ?? []

  return (
    <>
      <SessionInfoBar {...props} />

      <section className="panel approval-header">
        <h2>Approval Queue</h2>
        {testDataMode ? (
          <span className="approval-sub">3 proposed · human decides each</span>
        ) : (
          <span className="approval-sub">{proposals.length} proposed · human decides each</span>
        )}
      </section>

      <div className="approval-scroll">
        {testDataMode
          ? staticProposals.map((p) => (
              <section key={p.id} className="panel proposal-card">
                <div className="proposal-top">
                  <span className="proposal-name">{p.name}</span>
                  {p.status === 'approved' && (
                    <span className="badge badge-approved">Approved by: J. Rivera</span>
                  )}
                </div>
                {p.precedent && <span className="badge badge-precedent">{p.precedent}</span>}
                <p className="line">{p.rationale}</p>
                <p className="citation">{p.citation}</p>
                {p.status === 'pending' && (
                  <div className="big-decision-buttons">
                    <button className="big-btn yes" aria-label="Approve">
                      Yes
                    </button>
                    <button className="big-btn no" aria-label="Deny">
                      No
                    </button>
                  </div>
                )}
              </section>
            ))
          : live.session &&
            (proposals.length > 0 ? (
              proposals.map((p) => (
                <LiveProposalCard
                  key={p.proposal_id}
                  proposal={p}
                  session={live.session as Session}
                  onDecision={props.onDecision}
                />
              ))
            ) : (
              <section className="panel proposal-card">
                <p className="line">No proposals yet for this session.</p>
                <div className="big-decision-buttons">
                  <button className="big-btn yes" disabled={live.loading} onClick={onRunConsult}>
                    Run Consult
                  </button>
                </div>
              </section>
            ))}
        {!testDataMode && live.error && <p className="live-error">{live.error}</p>}
      </div>
    </>
  )
}

function VisitNoteScreen(props: ScreenProps) {
  const { testDataMode, live } = props

  if (testDataMode) {
    return (
      <>
        <SessionInfoBar {...props} />

        <div className="note-scroll">
          <section className="panel note-section">
            <h2>Chief Complaint</h2>
            <p className="line">
              <span className="hl-patient">John Doe</span>, 54M — sudden, sharp{' '}
              <span className="hl-observation">chest pain</span>, onset today.
            </p>
          </section>

          <section className="panel note-section">
            <h2>Symptoms</h2>
            <ul className="note-list">
              <li>Chest pain — sudden onset, non-radiating</li>
              <li>Shortness of breath — worse at rest</li>
            </ul>
          </section>

          <section className="panel note-section">
            <h2>Orders</h2>
            <ul className="note-list">
              <li>
                ECG <span className="badge badge-approved small">Approved · J. Rivera</span>
              </li>
              <li>
                Troponin Panel{' '}
                <span className="badge badge-approved small">Approved · J. Rivera</span>
              </li>
              <li>Chest X-ray — pending decision</li>
            </ul>
          </section>

          <section className="panel note-section">
            <h2>Next Steps</h2>
            <p className="line">
              Awaiting troponin results. Monitor for recurrent chest pain. Cardiology
              consult if ECG positive.
            </p>
          </section>

          <p className="note-disclaimer">
            Pathway is illustrative scaffolding, not a validated clinical protocol.
          </p>
        </div>
      </>
    )
  }

  const session = live.session
  const patientLines = session?.transcript.filter((u) => u.speaker === 'patient') ?? []

  return (
    <>
      <SessionInfoBar {...props} />

      <div className="note-scroll">
        <section className="panel note-section">
          <h2>Chief Complaint</h2>
          <p className="line">{patientLines[0]?.text ?? 'No utterances recorded yet.'}</p>
        </section>

        <section className="panel note-section">
          <h2>Symptoms</h2>
          {patientLines.length > 0 ? (
            <ul className="note-list">
              {patientLines.map((u) => (
                <li key={u.utterance_id}>{u.text}</li>
              ))}
            </ul>
          ) : (
            <p className="line">None recorded.</p>
          )}
        </section>

        <section className="panel note-section">
          <h2>Orders</h2>
          {session && session.proposals.length > 0 ? (
            <ul className="note-list">
              {session.proposals.map((p) => (
                <li key={p.proposal_id}>
                  {p.label}{' '}
                  <span
                    className={`badge small ${
                      p.status === 'refused'
                        ? 'badge-refused'
                        : p.status === 'denied'
                          ? 'badge-denied'
                          : 'badge-approved'
                    }`}
                  >
                    {p.status}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="line">No consult run yet.</p>
          )}
        </section>

        <section className="panel note-section">
          <h2>Audit Trail</h2>
          {session && session.audit.length > 0 ? (
            <ul className="note-list">
              {session.audit.map((row) => (
                <li key={row.audit_id}>
                  {new Date(row.ts).toLocaleTimeString()} — {row.actor} {row.action} →{' '}
                  {row.outcome}
                </li>
              ))}
            </ul>
          ) : (
            <p className="line">No audit entries yet.</p>
          )}
        </section>

        <p className="note-disclaimer">
          Pathway is illustrative scaffolding, not a validated clinical protocol.
        </p>
      </div>
    </>
  )
}

const screens = [LiveVisitScreen, ApprovalScreen, VisitNoteScreen]

function App() {
  const [screenIndex, setScreenIndex] = useState(0)
  const [presentationMode, setPresentationMode] = useState(true)
  const [testDataMode, setTestDataMode] = useState(false)
  const [inputMode, setInputMode] = useState<InputMode>('type')
  const [nurseIndex, setNurseIndex] = useState(0)
  const [pathwayHistory, setPathwayHistory] = useState<string[]>([])
  const [live, setLive] = useState<LiveState>({ session: null, loading: false, error: null })
  const sttModeRef = useRef<string | null>(null)
  const initialized = useRef(false)

  const nurse = NURSES[nurseIndex]
  const ScreenComponent = screens[screenIndex]

  // Track every pathway node the advisory loop has visited so the live graph
  // can draw the classification trail, not just the current node.
  const adoptSession = (session: Session, error: string | null = null) => {
    setLive({ session, loading: false, error })
    setPathwayHistory((history) => {
      const node = session.suggestions.pathway_node
      return history[history.length - 1] === node ? history : [...history, node]
    })
  }

  const ensureSession = async (): Promise<Session | null> => {
    if (live.session) return live.session
    setLive((s) => ({ ...s, loading: true, error: null }))
    try {
      const session = await createSession()
      adoptSession(session)
      return session
    } catch (error) {
      setLive({ session: null, loading: false, error: (error as Error).message })
      return null
    }
  }

  useEffect(() => {
    if (initialized.current) return
    initialized.current = true
    if (!testDataMode) void ensureSession()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleTestDataToggle = (checked: boolean) => {
    setTestDataMode(checked)
    if (!checked) void ensureSession()
  }

  const handleSendUtterance = async (text: string, speaker: Speaker) => {
    const session = await ensureSession()
    if (!session) return
    setLive((s) => ({ ...s, loading: true, error: null }))
    try {
      const updated = await sendUtterance(session.session_id, text, speaker)
      adoptSession(updated)
    } catch (error) {
      setLive((s) => ({ ...s, loading: false, error: (error as Error).message }))
    }
  }

  // Mic path adapts to the backend's STT mode: live STT takes raw audio on
  // /utterance; echo/stub STT gets the recording transcribed by the always-on
  // /whisperx/transcribe endpoint and receives the text instead.
  const handleSendAudio = async (blob: Blob, speaker: Speaker) => {
    const session = await ensureSession()
    if (!session) return
    setLive((s) => ({ ...s, loading: true, error: null }))
    try {
      if (sttModeRef.current === null) {
        sttModeRef.current = (await getHealth()).stt_mode
      }
      let updated: Session
      if (sttModeRef.current === 'live') {
        updated = await sendUtteranceAudio(session.session_id, blob, speaker)
      } else {
        const result = await transcribeAudio(blob)
        if (!result.text.trim()) {
          throw new Error('WhisperX returned an empty transcript.')
        }
        updated = await sendUtterance(session.session_id, result.text, speaker)
      }
      adoptSession(updated)
    } catch (error) {
      setLive((s) => ({ ...s, loading: false, error: (error as Error).message }))
    }
  }

  const handleRunConsult = async () => {
    const session = await ensureSession()
    if (!session) return
    setLive((s) => ({ ...s, loading: true, error: null }))
    try {
      await requestConsult(session.session_id)
      adoptSession(await getSession(session.session_id))
    } catch (error) {
      setLive((s) => ({ ...s, loading: false, error: (error as Error).message }))
    }
  }

  const handleDecision = async (proposalId: string, decision: 'approve' | 'deny') => {
    const session = live.session
    if (!session) return
    setLive((s) => ({ ...s, loading: true, error: null }))
    let failure: string | null = null
    try {
      await decideProposal(proposalId, decision, { id: nurse.id, name: nurse.name })
    } catch (error) {
      // Keep the message: a 502 here is the egress gate failing closed — the
      // approval is still audited, but the nurse should see the submit failed.
      failure = (error as Error).message
    }
    try {
      adoptSession(await getSession(session.session_id), failure)
    } catch (error) {
      setLive((s) => ({ ...s, loading: false, error: failure ?? (error as Error).message }))
    }
  }

  const screenProps: ScreenProps = {
    testDataMode,
    presentationMode,
    live,
    nurseIndex,
    onNurseChange: setNurseIndex,
    inputMode,
    onInputModeChange: setInputMode,
    pathwayHistory,
    onSendUtterance: (text, speaker) => void handleSendUtterance(text, speaker),
    onSendAudio: handleSendAudio,
    onRunConsult: () => void handleRunConsult(),
    onDecision: (proposalId, decision) => void handleDecision(proposalId, decision),
  }

  return (
    <div className="page">
      <div className="page-toggles">
        <label className="presentation-toggle">
          <input
            type="checkbox"
            checked={presentationMode}
            onChange={(e) => setPresentationMode(e.target.checked)}
          />
          Presentation mode
        </label>
        <label className="presentation-toggle">
          <input
            type="checkbox"
            checked={testDataMode}
            onChange={(e) => handleTestDataToggle(e.target.checked)}
          />
          Test data
        </label>
      </div>

      <div className={`tablet${presentationMode ? ' presentation-mode' : ''}`}>
        <div className="screen">
          <ScreenComponent {...screenProps} />
        </div>
      </div>

      <button
        className="nav-button back"
        aria-label="Previous screen"
        disabled={screenIndex === 0}
        onClick={() => setScreenIndex((i) => Math.max(0, i - 1))}
      >
        &#8592;
      </button>
      <button
        className="nav-button next"
        aria-label="Next screen"
        disabled={screenIndex === screens.length - 1}
        onClick={() => setScreenIndex((i) => Math.min(screens.length - 1, i + 1))}
      >
        &#8594;
      </button>
    </div>
  )
}

export default App
