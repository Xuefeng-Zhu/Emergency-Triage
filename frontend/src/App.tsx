import { useState } from 'react'
import './App.css'
import { createSession, decideProposal, getSession, requestConsult, sendUtterance } from './api'
import type { Proposal, Session } from './types'

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

type LiveState = {
  session: Session | null
  loading: boolean
  error: string | null
}

type ScreenProps = {
  testDataMode: boolean
  live: LiveState
  nurse: Nurse
  onSendUtterance: (text: string, speaker: 'nurse' | 'patient') => void
  onRunConsult: () => void
  onDecision: (proposalId: string, decision: 'approve' | 'deny') => void
}

function sessionLabel(session: Session | null): string {
  return session ? session.session_id.slice(-8).toUpperCase() : 'Starting…'
}

function SessionInfoBar({ testDataMode, live, nurse }: ScreenProps) {
  if (testDataMode) {
    return (
      <section className="panel session-info">
        <span>SESSION #2291 · NURSE J. RIVERA · 08:42:15</span>
      </section>
    )
  }
  return (
    <section className="panel session-info">
      <span>
        SESSION #{sessionLabel(live.session)} · NURSE {nurse.name}
        {live.session ? ` · ${new Date(live.session.started_at).toLocaleTimeString()}` : ''}
      </span>
    </section>
  )
}

function LiveVisitScreen(props: ScreenProps) {
  const { testDataMode, live, onSendUtterance } = props
  const [draft, setDraft] = useState('')

  const send = (speaker: 'nurse' | 'patient') => {
    if (!draft.trim()) return
    onSendUtterance(draft, speaker)
    setDraft('')
  }

  return (
    <div className="live-visit-grid">
      <div className="record-row">
        <button className="record-button" aria-label="Record" />
      </div>

      <SessionInfoBar {...props} />

      <section className="panel transcript">
        <h2>Transcript</h2>
        {testDataMode ? (
          <div className="transcript-scroll">
            <p className="line">
              Patient: I'm <span className="hl-patient">John Doe</span>, 54. Sudden,
              sharp <span className="hl-observation">chest pain</span>.
            </p>
            <p className="line">
              Nurse: Does it <span className="hl-question">radiate to your arm</span>?
            </p>
            <p className="line">Patient: No, just my chest.</p>
            <p className="line">
              Nurse: Any <span className="hl-observation">shortness of breath</span>?
            </p>
            <p className="line">
              Patient: Yes, worse <span className="hl-question">at rest</span>.
            </p>
            <p className="line">
              Agent: Suggests <span className="hl-diagnosis">possible ACS</span> —
              recommend ECG + troponin.
            </p>
            <p className="line">
              Nurse: Any <span className="hl-question">prior cardiac history</span> or{' '}
              <span className="hl-question">family MI history</span>?
            </p>
          </div>
        ) : (
          <>
            <div className="transcript-scroll">
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
            {live.error && <p className="live-error">{live.error}</p>}
          </>
        )}
      </section>

      <section className="panel choice">
        <div className="diagnosis-description">
          {testDataMode ? (
            <>
              <h2>Diagnosis Description</h2>
              <p className="score">Score 7/10</p>
              <p className="line">
                Acute chest pain, exertional onset. Recommend ECG + troponin panel given
                risk factors.
              </p>
            </>
          ) : (
            <>
              <h2>Pathway Node</h2>
              <p className="line">
                {live.session?.suggestions.pathway_node ?? 'intake'}
              </p>
            </>
          )}
        </div>
        <div className="selection-buttons">
          <button className="sel-btn check" aria-label="Approve">
            &#10003;
          </button>
          <button className="sel-btn neutral" aria-label="Neutral">
            &#9675;
          </button>
          <button className="sel-btn deny" aria-label="Deny">
            &#10005;
          </button>
        </div>
      </section>

      <section className="panel suggestions">
        <div className="suggestions-header">
          <h2>Suggestions</h2>
          {testDataMode && (
            <div className="legend">
              <span className="legend-item patient">Patient</span>
              <span className="legend-item observation">Observation</span>
              <span className="legend-item question">Question</span>
              <span className="legend-item diagnosis">Diagnosis</span>
            </div>
          )}
        </div>
        {testDataMode ? (
          <div className="graph-scroll">
            <SuggestionGraph />
          </div>
        ) : (
          <div className="graph-scroll">
            {live.session && live.session.suggestions.questions.length > 0 ? (
              <ul className="note-list">
                {live.session.suggestions.questions.map((q) => (
                  <li key={q.id}>
                    {q.text}
                    <br />
                    <span className="citation">{q.rationale}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="line">No suggestions yet.</p>
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
  const [presentationMode, setPresentationMode] = useState(false)
  const [testDataMode, setTestDataMode] = useState(true)
  const [nurseIndex] = useState(0)
  const [live, setLive] = useState<LiveState>({ session: null, loading: false, error: null })

  const nurse = NURSES[nurseIndex]
  const ScreenComponent = screens[screenIndex]

  const ensureSession = async (): Promise<Session | null> => {
    if (live.session) return live.session
    setLive((s) => ({ ...s, loading: true, error: null }))
    try {
      const session = await createSession()
      setLive({ session, loading: false, error: null })
      return session
    } catch (error) {
      setLive({ session: null, loading: false, error: (error as Error).message })
      return null
    }
  }

  const handleTestDataToggle = (checked: boolean) => {
    setTestDataMode(checked)
    if (!checked) void ensureSession()
  }

  const handleSendUtterance = async (text: string, speaker: 'nurse' | 'patient') => {
    const session = await ensureSession()
    if (!session) return
    setLive((s) => ({ ...s, loading: true, error: null }))
    try {
      const updated = await sendUtterance(session.session_id, text, speaker)
      setLive({ session: updated, loading: false, error: null })
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
      const updated = await getSession(session.session_id)
      setLive({ session: updated, loading: false, error: null })
    } catch (error) {
      setLive((s) => ({ ...s, loading: false, error: (error as Error).message }))
    }
  }

  const handleDecision = async (proposalId: string, decision: 'approve' | 'deny') => {
    const session = live.session
    if (!session) return
    setLive((s) => ({ ...s, loading: true, error: null }))
    try {
      await decideProposal(proposalId, decision, { id: nurse.id, name: nurse.name })
    } catch (error) {
      setLive((s) => ({ ...s, loading: false, error: (error as Error).message }))
    } finally {
      const updated = await getSession(session.session_id)
      setLive({ session: updated, loading: false, error: null })
    }
  }

  const screenProps: ScreenProps = {
    testDataMode,
    live,
    nurse,
    onSendUtterance: (text, speaker) => void handleSendUtterance(text, speaker),
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
