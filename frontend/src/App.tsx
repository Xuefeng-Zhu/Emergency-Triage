import './App.css'

type NodeType = 'patient' | 'observation' | 'question' | 'diagnosis'

type GraphNode = {
  id: string
  x: number
  y: number
  r: number
  type: NodeType
  lines: string[]
}

const LEVEL_Y = [34, 115, 205, 295, 385]

const graphNodes: GraphNode[] = [
  { id: 'patient', x: 140, y: LEVEL_Y[0], r: 26, type: 'patient', lines: ['John Doe', '54M'] },

  { id: 'chestPain', x: 70, y: LEVEL_Y[1], r: 24, type: 'observation', lines: ['Chest', 'Pain'] },
  { id: 'sob', x: 210, y: LEVEL_Y[1], r: 24, type: 'observation', lines: ['Short of', 'Breath'] },

  { id: 'onset', x: 40, y: LEVEL_Y[2], r: 21, type: 'question', lines: ['Onset', 'sudden?'] },
  { id: 'radiates', x: 100, y: LEVEL_Y[2], r: 21, type: 'question', lines: ['Radiates', 'to arm?'] },
  { id: 'restExertion', x: 210, y: LEVEL_Y[2], r: 21, type: 'question', lines: ['Rest or', 'exertion?'] },

  { id: 'possibleACS', x: 25, y: LEVEL_Y[3], r: 21, type: 'diagnosis', lines: ['Possible', 'ACS'] },
  { id: 'cardiacOrigin', x: 70, y: LEVEL_Y[3], r: 19, type: 'diagnosis', lines: ['Cardiac', 'origin'] },

  { id: 'priorCardiac', x: 15, y: LEVEL_Y[4], r: 18, type: 'question', lines: ['Cardiac', 'hx?'] },
  { id: 'familyMI', x: 55, y: LEVEL_Y[4], r: 18, type: 'question', lines: ['Family', 'MI hx?'] },
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
        return <line key={`${fromId}-${toId}`} x1={from.x} y1={from.y} x2={to.x} y2={to.y} />
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

function App() {
  return (
    <div className="page">
      <div className="tablet">
        <div className="screen">
          <div className="record-row">
            <button className="record-button" aria-label="Record" />
          </div>

          <section className="panel session-info">
            <span>SESSION #2291 · NURSE J. RIVERA · 08:42:15</span>
          </section>

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

          <section className="panel choice">
            <div className="diagnosis-description">
              <h2>Diagnosis Description</h2>
              <p className="score">Score 7/10</p>
              <p className="line">
                Acute chest pain, exertional onset. Recommend ECG + troponin panel
                given risk factors.
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
        </div>
      </div>

      <button className="next-screen-button" aria-label="Next screen">
        &#8594;
      </button>
    </div>
  )
}

export default App
