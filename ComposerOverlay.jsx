import { useState, useEffect } from "react";
import { apiRequest } from "./api.js";
import "../audioPlayback.js"; // side-effect: wires window.__playComposition

// ─── Constants ────────────────────────────────────────────────────────────────

const PART_ROLES = [
  { id: "melody",         label: "Melody",        color: "#C9A84C" },
  { id: "counter_melody", label: "Counter Melody", color: "#7ec8e3" },
  { id: "harmony",        label: "Harmony",        color: "#8adf9a" },
  { id: "bass",           label: "Bass",           color: "#e38a8a" },
  { id: "other",          label: "Other",          color: "#c8a0e3" },
];

const KEYS  = ["C","C#","Db","D","D#","Eb","E","F","F#","Gb","G","G#","Ab","A","A#","Bb","B"];
const MODES = ["major","minor","dorian","mixolydian","pentatonic"];

const DRUM_ROWS = [
  { id: "crash",    label: "Crash",    color: "#e8d9b0" },
  { id: "open_hat", label: "Open Hat", color: "#c9e890" },
  { id: "hihat",    label: "Hi-Hat",   color: "#90d4e8" },
  { id: "tom",      label: "Tom",      color: "#d090e8" },
  { id: "snare",    label: "Snare",    color: "#e8b090" },
  { id: "kick",     label: "Kick",     color: "#C9A84C" },
];

// ─── ScoreStrip ───────────────────────────────────────────────────────────────

function ScoreStrip({ notes, color, measures }) {
  const W = 600, H = 60;
  const midis = notes.map(n => n.pitch_midi || 60);
  const lo = Math.min(...midis, 48);
  const hi = Math.max(...midis, 84);
  const range = hi - lo || 12;

  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: "block", overflow: "visible" }}>
      <rect width={W} height={H} fill="#1a1610" rx="4"/>
      {Array.from({ length: measures + 1 }).map((_, i) => (
        <line key={i} x1={i * W / measures} y1={0} x2={i * W / measures} y2={H}
          stroke={i % 4 === 0 ? "#3a2e18" : "#252015"}
          strokeWidth={i % 4 === 0 ? 1 : 0.5}/>
      ))}
      {notes.map((n, i) => {
        const x = ((n.measure - 1 + (n.beat - 1) / 4) / measures) * W;
        const w = Math.max(4, (n.duration / (measures * 4)) * W);
        const midi = n.pitch_midi || 60;
        const y = H - ((midi - lo) / range) * (H - 8) - 6;
        return <rect key={i} x={x} y={y} width={w - 1} height={5} rx={2} fill={color} opacity={0.85}/>;
      })}
    </svg>
  );
}

// ─── PianoRollGrid ────────────────────────────────────────────────────────────

function PianoRollGrid({ midiLow, midiHigh, beats16, cells, eraseMode, onCellInteract }) {
  const CELL_W = 22, CELL_H = 14, KEY_W = 52;
  const totalRows = midiHigh - midiLow + 1;
  const NOTE_NAMES = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];
  const isBlack = midi => [1,3,6,8,10].includes(midi % 12);
  const isActive = (midi, b16) => cells.some(c => c.pitch_midi === midi && c.beat_16th === b16);

  const handlePointerDown = (midi, b16, e) => { e.preventDefault(); onCellInteract(midi, b16); };
  const handlePointerEnter = (midi, b16, e) => { if (e.buttons === 1) onCellInteract(midi, b16); };

  const gridWidth = beats16 * CELL_W;

  return (
    <div style={{ display: "flex", userSelect: "none" }}>
      {/* Piano keyboard */}
      <div style={{ width: KEY_W, flexShrink: 0, position: "sticky", left: 0, zIndex: 10, background: "#181410" }}>
        {Array.from({ length: totalRows }).map((_, i) => {
          const midi = midiHigh - i;
          const black = isBlack(midi);
          const noteName = NOTE_NAMES[midi % 12];
          const isC = midi % 12 === 0;
          return (
            <div key={midi} style={{
              height: CELL_H, display: "flex", alignItems: "center", justifyContent: "flex-end",
              paddingRight: 4,
              background: black ? "#2a2020" : isC ? "#1e1a14" : "#181410",
              borderBottom: isC ? "1px solid #3a2e18" : "1px solid #221a14",
              color: black ? "#554030" : isC ? "#C9A84C" : "#5a4030",
              fontSize: 9, fontFamily: "monospace",
            }}>
              {(isC || noteName.length === 2) ? noteName + (Math.floor(midi / 12) - 1) : ""}
            </div>
          );
        })}
      </div>

      {/* Grid */}
      <div style={{ overflowX: "auto" }}>
        <div style={{ width: gridWidth, position: "relative" }}>
          {Array.from({ length: totalRows }).map((_, i) => {
            const midi = midiHigh - i;
            const black = isBlack(midi);
            const isC = midi % 12 === 0;
            return (
              <div key={midi} style={{
                display: "flex", height: CELL_H,
                borderBottom: isC ? "1px solid #3a2e18" : "1px solid #1e1810",
                background: black ? "#171410" : "#1a1610",
              }}>
                {Array.from({ length: beats16 }).map((_, b) => {
                  const on = isActive(midi, b);
                  const beatStart = b % 16 === 0;
                  const groupStart = b % 4 === 0;
                  return (
                    <div key={b}
                      onPointerDown={e => handlePointerDown(midi, b, e)}
                      onPointerEnter={e => handlePointerEnter(midi, b, e)}
                      style={{
                        width: CELL_W - 1, height: "100%", flexShrink: 0,
                        marginRight: 1,
                        marginLeft: beatStart && b > 0 ? 3 : 0,
                        background: on ? (eraseMode ? "#8b2222" : "#C9A84C") : "transparent",
                        borderLeft: beatStart ? "1px solid #3a2e18" : groupStart ? "1px solid #221a14" : "none",
                        borderRadius: on ? 2 : 0,
                        cursor: eraseMode ? "cell" : "crosshair",
                        transition: "background 0.05s",
                      }}
                    />
                  );
                })}
              </div>
            );
          })}
          {/* Measure numbers */}
          <div style={{ position: "absolute", top: 0, left: 0, pointerEvents: "none", display: "flex" }}>
            {Array.from({ length: Math.ceil(beats16 / 16) }).map((_, m) => (
              <div key={m} style={{
                width: 16 * CELL_W, fontSize: 9, color: "#C9A84C",
                paddingLeft: 2, opacity: 0.6, flexShrink: 0,
              }}>M{m + 1}</div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── ComposerOverlay ──────────────────────────────────────────────────────────

export default function ComposerOverlay({ onClose }) {
  const [composerTab, setComposerTab] = useState("setup");
  const [compositions, setCompositions] = useState([]);
  const [activeComp, setActiveComp]     = useState(null);
  const [setupForm, setSetupForm] = useState({
    title: "New Piece", key: "C", mode: "major", tempo: 120, time_signature: "4/4", measures: 8,
  });
  const [selectedParts, setSelectedParts] = useState(["melody"]);
  const [generatingPart, setGeneratingPart] = useState(null);
  const [saveStatus, setSaveStatus] = useState("");
  const [error, setError]           = useState("");
  const [isPlaying, setIsPlaying]   = useState(false);

  const [drumPattern, setDrumPattern] = useState(() => {
    const p = {};
    DRUM_ROWS.forEach(r => { p[r.id] = Array(16).fill(0); });
    return p;
  });
  const [drumSteps] = useState(16);

  const [pianoRollPart, setPianoRollPart]   = useState("melody");
  const [pianoRollCells, setPianoRollCells] = useState([]);
  const [pianoEraseMode, setPianoEraseMode] = useState(false);

  const PIANO_MIDI_LOW  = 48;
  const PIANO_MIDI_HIGH = 83;
  const BEATS_16 = (activeComp?.measures || setupForm.measures) * 16;

  useEffect(() => {
    apiRequest("/composer/compositions").then(setCompositions).catch(() => {});
  }, []);

  async function createComposition() {
    try {
      const data = await apiRequest("/composer/compositions", { method: "POST", body: JSON.stringify(setupForm) });
      const full = await apiRequest(`/composer/compositions/${data.id}`);
      setActiveComp(full);
      setCompositions(prev => [{ ...full }, ...prev]);
      const existingRoles = full.parts.map(p => p.role);
      setSelectedParts(existingRoles.length ? existingRoles : ["melody"]);
      if (full.drum_pattern) setDrumPattern(full.drum_pattern.pattern);
      setComposerTab("score");
    } catch (e) { setError(e.message); }
  }

  async function loadComposition(id) {
    try {
      const full = await apiRequest(`/composer/compositions/${id}`);
      setActiveComp(full);
      setSetupForm({ title: full.title, key: full.key, mode: full.mode,
        tempo: full.tempo, time_signature: full.time_signature, measures: full.measures });
      setSelectedParts(full.parts.map(p => p.role).length ? full.parts.map(p => p.role) : ["melody"]);
      if (full.drum_pattern) setDrumPattern(full.drum_pattern.pattern);
      const pr = full.piano_rolls?.find(r => r.part_role === pianoRollPart);
      if (pr) setPianoRollCells(pr.cells);
      setComposerTab("score");
    } catch (e) { setError(e.message); }
  }

  async function generatePart(role) {
    if (!activeComp) return;
    setGeneratingPart(role);
    setError("");
    try {
      const genPath = role === "counter_melody" ? "/composer/generate/counter_melody"
        : role === "harmony" ? "/composer/generate/harmony"
        : role === "bass"    ? "/composer/generate/bass"
        : "/composer/generate/melody";
      const existingMelody = activeComp.parts.find(p => p.role === "melody")?.notes || [];
      const result = await apiRequest(genPath, {
        method: "POST",
        body: JSON.stringify({
          key: activeComp.key, mode: activeComp.mode, measures: activeComp.measures,
          tempo: activeComp.tempo, time_signature: activeComp.time_signature,
          existing_melody: existingMelody,
        }),
      });
      await apiRequest(`/composer/compositions/${activeComp.id}/parts`, {
        method: "POST",
        body: JSON.stringify({ role: result.role, notes: result.notes }),
      });
      const updated = await apiRequest(`/composer/compositions/${activeComp.id}`);
      setActiveComp(updated);
      setSaveStatus(`Generated ${role} (${result.engine})`);
    } catch (e) { setError(e.message); }
    finally { setGeneratingPart(null); }
  }

  async function generateDrums() {
    if (!activeComp) return;
    setGeneratingPart("drums");
    try {
      const result = await apiRequest("/composer/generate/drums", {
        method: "POST",
        body: JSON.stringify({ time_signature: activeComp.time_signature }),
      });
      setDrumPattern(result.pattern);
      setSaveStatus("Generated drum pattern");
    } catch (e) { setError(e.message); }
    finally { setGeneratingPart(null); }
  }

  async function saveDrumPattern() {
    if (!activeComp) return;
    try {
      await apiRequest(`/composer/compositions/${activeComp.id}/drum_pattern`, {
        method: "POST",
        body: JSON.stringify({ pattern: drumPattern, steps: drumSteps, swing: 0 }),
      });
      setSaveStatus("Drum pattern saved");
    } catch (e) { setError(e.message); }
  }

  async function savePianoRoll() {
    if (!activeComp) return;
    try {
      await apiRequest(`/composer/compositions/${activeComp.id}/piano_roll`, {
        method: "POST",
        body: JSON.stringify({ part_role: pianoRollPart, cells: pianoRollCells }),
      });
      setSaveStatus("Piano roll saved to project");
    } catch (e) { setError(e.message); }
  }

  function exportXml() {
    if (!activeComp) return;
    window.open(`/composer/compositions/${activeComp.id}/export_xml`, "_blank");
  }

  async function deleteComposition(id) {
    if (!confirm("Delete this composition?")) return;
    await apiRequest(`/composer/compositions/${id}`, { method: "DELETE" }).catch(() => {});
    setCompositions(prev => prev.filter(c => c.id !== id));
    if (activeComp?.id === id) { setActiveComp(null); setComposerTab("setup"); }
  }

  function toggleDrum(rowId, step) {
    setDrumPattern(prev => ({
      ...prev,
      [rowId]: prev[rowId].map((v, i) => i === step ? (v ? 0 : 1) : v),
    }));
  }

  function isPianoRollActive(midi, beat16) {
    return pianoRollCells.some(c => c.pitch_midi === midi && c.beat_16th === beat16);
  }

  function handlePianoCellInteract(midi, beat16) {
    if (pianoEraseMode) {
      setPianoRollCells(prev => prev.filter(c => !(c.pitch_midi === midi && c.beat_16th === beat16)));
    } else {
      if (isPianoRollActive(midi, beat16)) {
        setPianoRollCells(prev => prev.filter(c => !(c.pitch_midi === midi && c.beat_16th === beat16)));
      } else {
        setPianoRollCells(prev => [...prev, {
          pitch_midi: midi, beat_16th: beat16, duration_16th: 1,
          measure: Math.floor(beat16 / 16) + 1,
        }]);
      }
    }
  }

  const cStyle = {
    overlay: {
      position:"fixed", inset:0, background:"rgba(0,0,0,0.92)", zIndex:500,
      display:"flex", flexDirection:"column", fontFamily:"'Georgia', serif",
    },
    header: {
      height:52, background:"#181410", borderBottom:"1px solid #2a2010",
      display:"flex", alignItems:"center", gap:16, padding:"0 20px", flexShrink:0,
    },
    title:    { fontSize:16, fontWeight:700, color:"#C9A84C", flex:1 },
    tab:      { padding:"14px 18px", background:"none", border:"none", color:"#554030", fontSize:13, cursor:"pointer", fontFamily:"inherit" },
    tabActive:{ color:"#C9A84C", borderBottom:"2px solid #C9A84C" },
    body:     { flex:1, overflow:"auto", padding:24, background:"#0e0c09" },
    card:     { background:"#181410", border:"1px solid #2a2010", borderRadius:10, padding:16, marginBottom:16 },
    label:    { fontSize:12, color:"#a89060", marginBottom:4, display:"block" },
    input:    { background:"#1e1a14", border:"1px solid #3a2e1e", borderRadius:6, padding:"7px 10px", color:"#e8d9b0", fontSize:13, fontFamily:"inherit", width:"100%", boxSizing:"border-box" },
    select:   { background:"#1e1a14", border:"1px solid #3a2e1e", borderRadius:6, padding:"7px 10px", color:"#e8d9b0", fontSize:13, fontFamily:"inherit", width:"100%" },
    btn:      { background:"#C9A84C", color:"#1a1200", border:"none", borderRadius:6, padding:"8px 16px", fontSize:13, fontWeight:700, cursor:"pointer" },
    btnSm:    { background:"#1e1a14", color:"#a89060", border:"1px solid #3a2e1e", borderRadius:6, padding:"5px 10px", fontSize:12, cursor:"pointer", fontFamily:"inherit" },
    btnDanger:{ background:"#2a1111", color:"#ee5555", border:"1px solid #8b2222", borderRadius:6, padding:"5px 10px", fontSize:12, cursor:"pointer" },
    row:      { display:"flex", gap:12, marginBottom:12 },
    col:      { flex:1 },
  };

  return (
    <div style={cStyle.overlay}>
      {/* Header */}
      <div style={cStyle.header}>
        <span style={cStyle.title}>♩ ScoreSync Composer</span>
        {["setup","score","drums","piano"].map(t => (
          <button key={t} style={{ ...cStyle.tab, ...(composerTab === t ? cStyle.tabActive : {}) }}
            onClick={() => setComposerTab(t)}>
            {t === "setup" ? "Project" : t === "score" ? "Score Builder" : t === "drums" ? "Drum Machine" : "Piano Roll"}
          </button>
        ))}
        <button style={{ ...cStyle.btnSm, marginLeft: "auto" }} onClick={onClose}>✕ Close</button>
      </div>

      {error && (
        <div style={{ background:"#2a1111", color:"#ffb3b3", padding:"8px 20px", fontSize:13, display:"flex", justifyContent:"space-between" }}>
          {error}
          <button style={{ background:"none", border:"none", color:"#ffb3b3", cursor:"pointer" }} onClick={() => setError("")}>✕</button>
        </div>
      )}
      {saveStatus && (
        <div style={{ background:"#1a2a1a", color:"#6aaa6a", padding:"6px 20px", fontSize:12 }}>
          ✓ {saveStatus}
        </div>
      )}

      <div style={cStyle.body}>

        {/* ── Project tab ── */}
        {composerTab === "setup" && (
          <>
            <div style={cStyle.card}>
              <div style={{ fontSize:14, color:"#C9A84C", fontWeight:700, marginBottom:14 }}>✕ New Composition</div>
              <div style={cStyle.row}>
                <div style={cStyle.col}>
                  <label style={cStyle.label}>Title</label>
                  <input style={cStyle.input} value={setupForm.title}
                    onChange={e => setSetupForm(f => ({ ...f, title: e.target.value }))} />
                </div>
                <div style={cStyle.col}>
                  <label style={cStyle.label}>Key</label>
                  <select style={cStyle.select} value={setupForm.key}
                    onChange={e => setSetupForm(f => ({ ...f, key: e.target.value }))}>
                    {KEYS.map(k => <option key={k}>{k}</option>)}
                  </select>
                </div>
                <div style={cStyle.col}>
                  <label style={cStyle.label}>Mode</label>
                  <select style={cStyle.select} value={setupForm.mode}
                    onChange={e => setSetupForm(f => ({ ...f, mode: e.target.value }))}>
                    {MODES.map(m => <option key={m}>{m}</option>)}
                  </select>
                </div>
              </div>
              <div style={cStyle.row}>
                <div style={cStyle.col}>
                  <label style={cStyle.label}>Tempo (BPM)</label>
                  <input style={cStyle.input} type="number" min="40" max="240" value={setupForm.tempo}
                    onChange={e => setSetupForm(f => ({ ...f, tempo: parseInt(e.target.value) || 120 }))} />
                </div>
                <div style={cStyle.col}>
                  <label style={cStyle.label}>Time Signature</label>
                  <select style={cStyle.select} value={setupForm.time_signature}
                    onChange={e => setSetupForm(f => ({ ...f, time_signature: e.target.value }))}>
                    {["4/4","3/4","2/4","6/8","5/4","7/8"].map(t => <option key={t}>{t}</option>)}
                  </select>
                </div>
                <div style={cStyle.col}>
                  <label style={cStyle.label}>Measures</label>
                  <input style={cStyle.input} type="number" min="1" max="64" value={setupForm.measures}
                    onChange={e => setSetupForm(f => ({ ...f, measures: parseInt(e.target.value) || 8 }))} />
                </div>
              </div>
              <div style={{ marginBottom: 14 }}>
                <label style={cStyle.label}>Parts to include</label>
                <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
                  {PART_ROLES.map(role => (
                    <button key={role.id}
                      style={{ ...cStyle.btnSm,
                        ...(selectedParts.includes(role.id)
                          ? { background: role.color + "22", border: `1px solid ${role.color}`, color: role.color }
                          : {})
                      }}
                      onClick={() => setSelectedParts(prev =>
                        prev.includes(role.id) ? prev.filter(r => r !== role.id) : [...prev, role.id]
                      )}>
                      {role.label}
                    </button>
                  ))}
                </div>
              </div>
              <button style={cStyle.btn} onClick={createComposition}>Create Composition</button>
            </div>

            {compositions.length > 0 && (
              <div style={cStyle.card}>
                <div style={{ fontSize:14, color:"#C9A84C", fontWeight:700, marginBottom:12 }}>Saved Compositions</div>
                {compositions.map(comp => (
                  <div key={comp.id} style={{ display:"flex", alignItems:"center", gap:10, padding:"8px 0", borderBottom:"1px solid #1e1810" }}>
                    <div style={{ flex:1 }}>
                      <div style={{ color:"#e8d9b0", fontSize:13, fontWeight:700 }}>{comp.title}</div>
                      <div style={{ color:"#665040", fontSize:11 }}>{comp.key} {comp.mode} • {comp.tempo}bpm • {comp.measures}m</div>
                    </div>
                    <button style={cStyle.btnSm} onClick={() => loadComposition(comp.id)}>Open</button>
                    <button style={cStyle.btnDanger} onClick={() => deleteComposition(comp.id)}>Delete</button>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {/* ── Score Builder tab ── */}
        {composerTab === "score" && (
          !activeComp ? (
            <div style={{ color:"#554030", textAlign:"center", padding:40 }}>
              Create or open a composition in the Project tab.
            </div>
          ) : (
            <>
              <div style={{ ...cStyle.card, display:"flex", alignItems:"center", gap:16, flexWrap:"wrap" }}>
                <div>
                  <div style={{ fontSize:15, color:"#C9A84C", fontWeight:700 }}>{activeComp.title}</div>
                  <div style={{ fontSize:12, color:"#665040" }}>
                    {activeComp.key} {activeComp.mode} • {activeComp.tempo} bpm • {activeComp.time_signature} • {activeComp.measures} measures
                  </div>
                </div>
                <div style={{ marginLeft:"auto", display:"flex", gap:8 }}>
                  <button
                    style={{ ...cStyle.btn, fontSize:12, padding:"6px 16px",
                      background: isPlaying ? "#aa3333" : "#C9A84C",
                      color: isPlaying ? "#fff" : "#1a1200" }}
                    onClick={() => window.__playComposition(activeComp, setIsPlaying)}>
                    {isPlaying ? "⏹ Stop" : "▶ Play"}
                  </button>
                  <button style={cStyle.btnSm} onClick={exportXml}>Export MusicXML</button>
                </div>
              </div>

              {PART_ROLES.filter(r => selectedParts.includes(r.id)).map(role => {
                const part = activeComp.parts.find(p => p.role === role.id);
                return (
                  <div key={role.id} style={{ ...cStyle.card, borderLeft: `3px solid ${role.color}` }}>
                    <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:10 }}>
                      <span style={{ fontSize:13, color:role.color, fontWeight:700 }}>{role.label}</span>
                      <span style={{ fontSize:11, color:"#554030" }}>
                        {part ? `${part.notes.length} notes` : "No notes yet"}
                      </span>
                      <div style={{ marginLeft:"auto", display:"flex", gap:6 }}>
                        <button style={cStyle.btnSm} disabled={generatingPart === role.id}
                          onClick={() => generatePart(role.id)}>
                          {generatingPart === role.id ? "Generating..." : "✨ AI Generate"}
                        </button>
                        {part && (
                          <button style={{ ...cStyle.btnSm, color:"#7ec8e3" }}
                            onClick={() => { setPianoRollPart(role.id); setComposerTab("piano"); }}>
                            Piano Roll
                          </button>
                        )}
                      </div>
                    </div>
                    {part && part.notes.length > 0 ? (
                      <ScoreStrip notes={part.notes} color={role.color} measures={activeComp.measures} />
                    ) : (
                      <div style={{ fontSize:11, color:"#3a2e18", padding:"8px 0" }}>
                        Use AI Generate, or switch to Piano Roll to draw notes.
                      </div>
                    )}
                  </div>
                );
              })}
            </>
          )
        )}

        {/* ── Drum Machine tab ── */}
        {composerTab === "drums" && (
          <>
            <div style={{ ...cStyle.card, display:"flex", alignItems:"center", gap:12, flexWrap:"wrap" }}>
              <span style={{ color:"#C9A84C", fontSize:14, fontWeight:700 }}>Drum Machine</span>
              <span style={{ color:"#665040", fontSize:12 }}>Click pads to toggle • 16th-note resolution</span>
              <div style={{ marginLeft:"auto", display:"flex", gap:8 }}>
                <button style={cStyle.btnSm} disabled={generatingPart === "drums"} onClick={generateDrums}>
                  {generatingPart === "drums" ? "Generating..." : "✨ AI Suggest"}
                </button>
                <button style={{ ...cStyle.btn, fontSize:12, padding:"6px 14px" }} onClick={saveDrumPattern}>
                  Save to Project
                </button>
              </div>
            </div>

            <div style={{ ...cStyle.card, overflowX:"auto" }}>
              <div style={{ display:"flex", marginBottom:6, marginLeft:80 }}>
                {Array.from({ length: drumSteps }).map((_, i) => (
                  <div key={i} style={{
                    width:30, textAlign:"center", fontSize:10, flexShrink:0,
                    color: i % 4 === 0 ? "#C9A84C" : "#3a2e18", fontFamily:"monospace",
                  }}>{i + 1}</div>
                ))}
              </div>
              {DRUM_ROWS.map(row => (
                <div key={row.id} style={{ display:"flex", alignItems:"center", marginBottom:4 }}>
                  <div style={{ width:76, fontSize:12, color:row.color, textAlign:"right", paddingRight:4, flexShrink:0 }}>
                    {row.label}
                  </div>
                  {Array.from({ length: drumSteps }).map((_, step) => {
                    const on = drumPattern[row.id]?.[step] === 1;
                    const groupStart = step % 4 === 0;
                    return (
                      <div key={step} onClick={() => toggleDrum(row.id, step)}
                        style={{
                          width:26, height:26, margin:"0 2px", borderRadius:4, cursor:"pointer", flexShrink:0,
                          marginLeft: groupStart && step > 0 ? 6 : 2,
                          background: on ? row.color : "#1e1a14",
                          border: on ? `1px solid ${row.color}` : "1px solid #2a2010",
                          transition:"background 0.08s",
                          boxShadow: on ? `0 0 6px ${row.color}66` : "none",
                        }}
                      />
                    );
                  })}
                </div>
              ))}
            </div>
          </>
        )}

        {/* ── Piano Roll tab ── */}
        {composerTab === "piano" && (
          <>
            <div style={{ ...cStyle.card, display:"flex", alignItems:"center", gap:12, flexWrap:"wrap" }}>
              <span style={{ color:"#C9A84C", fontSize:14, fontWeight:700 }}>Piano Roll</span>
              <select style={{ ...cStyle.select, width:180 }} value={pianoRollPart}
                onChange={e => {
                  setPianoRollPart(e.target.value);
                  const pr = activeComp?.piano_rolls?.find(r => r.part_role === e.target.value);
                  setPianoRollCells(pr ? pr.cells : []);
                }}>
                {PART_ROLES.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}
              </select>
              <button style={{ ...cStyle.btnSm, ...(pianoEraseMode ? { background:"#2a1111", color:"#ee5555", border:"1px solid #8b2222" } : {}) }}
                onClick={() => setPianoEraseMode(v => !v)}>
                {pianoEraseMode ? "🗑 Erase ON" : "✏ Draw"}
              </button>
              <button style={cStyle.btnSm} onClick={() => setPianoRollCells([])}>Clear</button>
              <button style={{ ...cStyle.btn, fontSize:12, padding:"6px 14px", marginLeft:"auto" }} onClick={savePianoRoll}>
                Save to Project
              </button>
            </div>

            <div style={{ ...cStyle.card, overflowX:"auto", overflowY:"auto", maxHeight:"calc(100vh - 260px)" }}>
              <PianoRollGrid
                midiLow={PIANO_MIDI_LOW}
                midiHigh={PIANO_MIDI_HIGH}
                beats16={BEATS_16}
                cells={pianoRollCells}
                eraseMode={pianoEraseMode}
                onCellInteract={handlePianoCellInteract}
              />
            </div>
          </>
        )}

      </div>
    </div>
  );
}
