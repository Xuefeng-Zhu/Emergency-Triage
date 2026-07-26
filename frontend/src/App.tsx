import { useState } from 'react'
import './App.css'

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

function SessionInfoBar() {
  return (
    <section className="panel session-info">
      <span>SESSION #2291 · NURSE J. RIVERA · 08:42:15</span>
    </section>
  )
}

function LiveVisitScreen() {
  return (
    <div className="live-visit-grid">
      <div className="record-row">
        <button className="record-button" aria-label="Record" />
      </div>

      <SessionInfoBar />

      <section className="panel transcript">
        <h2>Transcript</h2>
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
      </section>

      <section className="panel choice">
        <div className="diagnosis-description">
          <h2>Diagnosis Description</h2>
          <p className="score">Score 7/10</p>
          <p className="line">
            Acute chest pain, exertional onset. Recommend ECG + troponin panel given
            risk factors.
          </p>
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
          <div className="legend">
            <span className="legend-item patient">Patient</span>
            <span className="legend-item observation">Observation</span>
            <span className="legend-item question">Question</span>
            <span className="legend-item diagnosis">Diagnosis</span>
          </div>
        </div>
        <div className="graph-scroll">
          <SuggestionGraph />
        </div>
      </section>
    </div>
  )
}

type ProposalCard = {
  id: string
  name: string
  rationale: string
  citation: string
  status: 'pending' | 'approved'
  precedent?: string
}

const proposals: ProposalCard[] = [
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

function ApprovalScreen() {
  return (
    <>
      <SessionInfoBar />

      <section className="panel approval-header">
        <h2>Approval Queue</h2>
        <span className="approval-sub">3 proposed · human decides each</span>
      </section>

      <div className="approval-scroll">
        {proposals.map((p) => (
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
        ))}
      </div>
    </>
  )
}

function VisitNoteScreen() {
  return (
    <>
      <SessionInfoBar />

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
              Troponin Panel <span className="badge badge-approved small">Approved · J. Rivera</span>
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

const screens = [LiveVisitScreen, ApprovalScreen, VisitNoteScreen]

function App() {
  const [screenIndex, setScreenIndex] = useState(0)
  const [presentationMode, setPresentationMode] = useState(false)
  const ScreenComponent = screens[screenIndex]

  return (
    <div className="page">
      <label className="presentation-toggle">
        <input
          type="checkbox"
          checked={presentationMode}
          onChange={(e) => setPresentationMode(e.target.checked)}
        />
        Presentation mode
      </label>

      <div className={`tablet${presentationMode ? ' presentation-mode' : ''}`}>
        <div className="screen">
          <ScreenComponent />
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
