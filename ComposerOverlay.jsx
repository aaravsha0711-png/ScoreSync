import { useState, useEffect, useRef, useCallback } from "react";
import { apiRequest } from "./api.js";
import "./audioPlayback.js";

// ─── Palette ──────────────────────────────────────────────────────────────────
const C = {
  bg:      "#0a0906",
  surface: "#141210",
  card:    "#1a1712",
  border:  "#2a2418",
  gold:    "#C9A84C",
  goldDim: "#7a6530",
  text:    "#e8d9b0",
  muted:   "#6a5838",
  dimmer:  "#3a2e18",
  red:     "#c04040",
  green:   "#4a9a5a",
  blue:    "#4a7ab0",
};

// ─── Constants ────────────────────────────────────────────────────────────────
const PART_ROLES = [
  { id: "melody",         label: "Melody",        color: "#C9A84C" },
  { id: "counter_melody", label: "Counter Melody", color: "#7ec8e3" },
  { id: "harmony",        label: "Harmony",        color: "#8adf9a" },
  { id: "bass",           label: "Bass",           color: "#e38a8a" },
  { id: "other",          label: "Other",          color: "#c8a0e3" },
];

const KEYS  = ["C","C#","Db","D","D#","Eb","E","F","F#","Gb","G","G#","Ab","A","A#","Bb","B"];
const MODES = ["major","minor","dorian","mixolydian","pentatonic","blues","harmonic_minor"];
const TIME_SIGS = ["4/4","3/4","2/4","6/8","5/4","7/8","12/8"];

const DRUM_ROWS = [
  { id: "crash",    label: "Crash",    color: "#e8d9b0" },
  { id: "open_hat", label: "Open Hat", color: "#c9e890" },
  { id: "hihat",    label: "Hi-Hat",   color: "#90d4e8" },
  { id: "tom",      label: "Tom",      color: "#d090e8" },
  { id: "snare",    label: "Snare",    color: "#e8b090" },
  { id: "kick",     label: "Kick",     color: "#C9A84C" },
];

const SECTION_TYPES = ["intro","verse","chorus","bridge","outro","instrumental","pre-chorus","coda"];

const CAT_COLORS = {
  Classical:   "#d4b483",
  Jazz:        "#83b4d4",
  Blues:       "#7a9a7a",
  Rock:        "#d48383",
  Pop:         "#d4a0d4",
  Electronic:  "#83d4d4",
  "Hip-Hop":   "#c0a060",
  "R&B":       "#d490a0",
  Soul:        "#d4c083",
  Country:     "#b4c083",
  Folk:        "#a0b883",
  Reggae:      "#83d4a0",
  Latin:       "#d4b083",
  World:       "#a083d4",
  Metal:       "#c06060",
  Cinematic:   "#8090d4",
  Game:        "#60b0c0",
  Utility:     "#808080",
};

// ─── Shared styles ────────────────────────────────────────────────────────────
const S = {
  overlay: {
    position:"fixed", inset:0, background:"rgba(0,0,0,0.95)", zIndex:500,
    display:"flex", flexDirection:"column", fontFamily:"'Georgia', serif",
    color: C.text,
  },
  header: {
    height:52, background: C.surface, borderBottom:`1px solid ${C.border}`,
    display:"flex", alignItems:"center", gap:12, padding:"0 16px", flexShrink:0,
  },
  body: { flex:1, overflow:"auto", padding:"20px 24px", background: C.bg },
  card: {
    background: C.card, border:`1px solid ${C.border}`,
    borderRadius:10, padding:16, marginBottom:14,
  },
  label:  { fontSize:11, color: C.muted, marginBottom:4, display:"block", textTransform:"uppercase", letterSpacing:"0.05em" },
  input:  { background:"#1e1a14", border:`1px solid ${C.border}`, borderRadius:6, padding:"7px 10px", color: C.text, fontSize:13, fontFamily:"inherit", width:"100%", boxSizing:"border-box" },
  select: { background:"#1e1a14", border:`1px solid ${C.border}`, borderRadius:6, padding:"7px 10px", color: C.text, fontSize:13, fontFamily:"inherit", width:"100%" },
  btn:    { background: C.gold, color:"#1a1200", border:"none", borderRadius:6, padding:"8px 16px", fontSize:13, fontWeight:700, cursor:"pointer", fontFamily:"inherit" },
  btnSm:  { background: C.surface, color: C.muted, border:`1px solid ${C.border}`, borderRadius:6, padding:"5px 10px", fontSize:12, cursor:"pointer", fontFamily:"inherit" },
  btnDanger: { background:"#2a1111", color:"#ee5555", border:"1px solid #8b2222", borderRadius:6, padding:"5px 10px", fontSize:12, cursor:"pointer" },
  row:    { display:"flex", gap:12, marginBottom:12 },
  col:    { flex:1 },
  tab:    { padding:"14px 16px", background:"none", border:"none", color: C.muted, fontSize:13, cursor:"pointer", fontFamily:"inherit", borderBottom:"2px solid transparent" },
  tabActive: { color: C.gold, borderBottom:`2px solid ${C.gold}` },
};

// ─── ScoreStrip ───────────────────────────────────────────────────────────────
function ScoreStrip({ notes, color, totalMeasures, sections = [] }) {
  const W = 700, H = 56;
  if (!notes || notes.length === 0) {
    return (
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display:"block" }}>
        <rect width={W} height={H} fill="#111009" rx="4"/>
        <text x={W/2} y={H/2} textAnchor="middle" dominantBaseline="central" fontSize={11} fill="#3a2e18">No notes generated</text>
      </svg>
    );
  }
  const midis = notes.map(n => n.pitch_midi || 60);
  const lo = Math.min(...midis, 48);
  const hi = Math.max(...midis, 84);
  const range = hi - lo || 12;
  const meas = totalMeasures || Math.max(...notes.map(n => n.measure || 1), 8);

  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display:"block" }}>
      <rect width={W} height={H} fill="#111009" rx="4"/>
      {sections.map((sec, i) => {
        const x0 = ((sec.start_measure - 1) / meas) * W;
        const x1 = (sec.end_measure / meas) * W;
        return <rect key={i} x={x0} y={0} width={x1 - x0} height={H} fill={i % 2 === 0 ? "#ffffff05" : "#00000020"}/>;
      })}
      {sections.map((sec, i) => {
        const x = ((sec.start_measure - 1) / meas) * W + 3;
        return <text key={i} x={x} y={10} fill={C.goldDim} fontSize={8} fontFamily="Georgia">{sec.label}</text>;
      })}
      {Array.from({ length: meas + 1 }).map((_, i) => (
        <line key={i} x1={i * W / meas} y1={0} x2={i * W / meas} y2={H}
          stroke={i % 4 === 0 ? C.dimmer : "#1e1810"}
          strokeWidth={i % 4 === 0 ? 1 : 0.5}/>
      ))}
      {notes.map((n, i) => {
        const x = ((n.measure - 1 + (n.beat - 1) / 4) / meas) * W;
        const w = Math.max(3, (n.duration / (meas * 4)) * W);
        const midi = n.pitch_midi || 60;
        const y = H - 6 - ((midi - lo) / range) * (H - 12);
        return <rect key={i} x={x} y={y} width={w - 1} height={4} rx={2} fill={color} opacity={0.85}/>;
      })}
    </svg>
  );
}

// ─── StyleBrowser ─────────────────────────────────────────────────────────────
function StyleBrowser({ catalog, currentStyle, onSelect, onClose }) {
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState("All");

  const categories = ["All", ...Object.keys(catalog)];
  const filtered = Object.entries(catalog).flatMap(([cat, styles]) =>
    styles
      .filter(s =>
        (activeCategory === "All" || cat === activeCategory) &&
        (search === "" ||
          s.description.toLowerCase().includes(search.toLowerCase()) ||
          cat.toLowerCase().includes(search.toLowerCase()))
      )
      .map(s => ({ ...s, category: cat }))
  );

  return (
    <div style={{
      position:"fixed", inset:0, background:"rgba(0,0,0,0.97)", zIndex:600,
      display:"flex", flexDirection:"column", fontFamily:"'Georgia', serif",
    }}>
      <div style={{ padding:"14px 20px", borderBottom:`1px solid ${C.border}`, display:"flex", alignItems:"center", gap:12 }}>
        <span style={{ fontSize:15, fontWeight:700, color: C.gold, flex:1 }}>🎨 Style Browser — {Object.values(catalog).flat().length} styles</span>
        <input
          value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search styles…"
          style={{ ...S.input, width:220, margin:0 }}
          autoFocus
        />
        <button style={S.btnSm} onClick={onClose}>✕ Close</button>
      </div>

      <div style={{ padding:"10px 20px", display:"flex", gap:6, flexWrap:"wrap", borderBottom:`1px solid ${C.border}`, background: C.surface }}>
        {categories.map(cat => (
          <button key={cat} onClick={() => setActiveCategory(cat)} style={{
            padding:"4px 10px", borderRadius:20, border:"none", cursor:"pointer",
            fontFamily:"inherit", fontSize:11,
            background: activeCategory === cat ? (CAT_COLORS[cat] || C.gold) : C.card,
            color: activeCategory === cat ? "#1a1200" : C.muted,
            fontWeight: activeCategory === cat ? 700 : 400,
          }}>{cat}</button>
        ))}
      </div>

      <div style={{ flex:1, overflowY:"auto", padding:20 }}>
        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill, minmax(220px, 1fr))", gap:10 }}>
          {filtered.map(s => {
            const isActive = s.id === currentStyle;
            const accent = CAT_COLORS[s.category] || C.gold;
            return (
              <div key={s.id} onClick={() => { onSelect(s.id); onClose(); }}
                style={{
                  padding:"12px 14px", borderRadius:8, cursor:"pointer",
                  border: isActive ? `2px solid ${accent}` : `1px solid ${C.border}`,
                  background: isActive ? accent + "18" : C.card,
                  transition:"all 0.12s",
                }}>
                <div style={{ fontSize:12, fontWeight:700, color: isActive ? accent : C.text, marginBottom:4 }}>
                  {s.description}
                </div>
                <div style={{ fontSize:10, color: C.muted }}>
                  <span style={{ color: accent, marginRight:6 }}>{s.category}</span>
                  {s.tempo_range[0]}–{s.tempo_range[1]} BPM · {s.mode}
                </div>
              </div>
            );
          })}
        </div>
        {filtered.length === 0 && (
          <div style={{ textAlign:"center", color: C.muted, padding:40 }}>No styles match your search.</div>
        )}
      </div>
    </div>
  );
}

// ─── PartStyleBadge ── per-part style override picker ─────────────────────────
function PartStyleBadge({ partId, styleOverrides, styleCatalog, onSetOverride, onClearOverride }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const ref = useRef();
  const override = styleOverrides[partId];

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const allStyles = Object.entries(styleCatalog).flatMap(([cat, items]) =>
    items.map(s => ({ ...s, category: cat }))
  ).filter(s => search === "" || s.description.toLowerCase().includes(search.toLowerCase()));

  return (
    <div ref={ref} style={{ position:"relative" }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          ...S.btnSm, fontSize:10, padding:"3px 8px",
          ...(override ? { background:"#2a1e10", color: C.gold, border:`1px solid ${C.goldDim}` } : {}),
        }}
        title={override ? `Part style: ${override}` : "Override style for this part"}
      >
        {override ? `✦ ${override.replace(/_/g," ")}` : "＋ Part Style"}
      </button>

      {open && (
        <div style={{
          position:"absolute", top:"calc(100% + 4px)", left:0, zIndex:700,
          background: C.card, border:`1px solid ${C.border}`,
          borderRadius:8, width:290, boxShadow:"0 8px 32px rgba(0,0,0,0.7)", padding:10,
        }}>
          <div style={{ fontSize:11, color: C.gold, marginBottom:8, fontWeight:700 }}>
            Override style for this part
          </div>
          <input
            value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search…" autoFocus
            style={{ ...S.input, marginBottom:8, fontSize:12 }}
          />
          <div style={{ maxHeight:260, overflowY:"auto" }}>
            {override && (
              <div
                onClick={() => { onClearOverride(partId); setOpen(false); setSearch(""); }}
                style={{
                  padding:"6px 8px", color: C.red, fontSize:12, cursor:"pointer",
                  borderBottom:`1px solid ${C.border}`, marginBottom:4,
                  display:"flex", alignItems:"center", gap:6,
                }}>
                ✕ Clear override (use global style)
              </div>
            )}
            {allStyles.map(s => (
              <div key={s.id}
                onClick={() => { onSetOverride(partId, s.id); setOpen(false); setSearch(""); }}
                style={{
                  padding:"6px 8px", borderRadius:4, cursor:"pointer", fontSize:12,
                  background: s.id === override ? C.gold + "22" : "transparent",
                  color: s.id === override ? C.gold : C.text,
                  display:"flex", justifyContent:"space-between", alignItems:"center",
                }}>
                <span>{s.description}</span>
                <span style={{ fontSize:10, color: CAT_COLORS[s.category] || C.muted }}>{s.category}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── SectionEditor ────────────────────────────────────────────────────────────
function SectionEditor({ sections, onChange }) {
  function add() {
    onChange([...sections, { type:"verse", measures:8, label:`Section ${sections.length + 1}` }]);
  }
  function remove(i) { onChange(sections.filter((_, idx) => idx !== i)); }
  function update(i, field, value) {
    onChange(sections.map((s, idx) => idx === i ? { ...s, [field]: value } : s));
  }
  function move(i, dir) {
    const arr = [...sections];
    const swap = i + dir;
    if (swap < 0 || swap >= arr.length) return;
    [arr[i], arr[swap]] = [arr[swap], arr[i]];
    onChange(arr);
  }

  const totalMeasures = sections.reduce((s, sec) => s + (sec.measures || 8), 0);

  const SECTION_BG = {
    intro:"#1a2015", verse:"#1a1520", chorus:"#201a15",
    bridge:"#15201a", outro:"#1a1a20", instrumental:"#1a1a15",
    "pre-chorus":"#1a1a18", coda:"#1a1515",
  };

  return (
    <div>
      <div style={{ display:"flex", alignItems:"center", marginBottom:10, gap:8 }}>
        <span style={{ fontSize:13, fontWeight:700, color: C.gold }}>Song Structure</span>
        <span style={{ fontSize:11, color: C.muted, marginLeft:"auto" }}>
          {sections.length} sections · {totalMeasures} total measures
        </span>
        <button style={S.btnSm} onClick={add}>＋ Add Section</button>
      </div>

      {sections.map((sec, i) => (
        <div key={i} style={{
          display:"flex", alignItems:"center", gap:8, padding:"8px 10px",
          background: SECTION_BG[sec.type] || C.surface,
          borderRadius:6, marginBottom:5, border:`1px solid ${C.border}`,
        }}>
          <div style={{ display:"flex", flexDirection:"column", gap:2 }}>
            <button style={{ ...S.btnSm, padding:"1px 5px", fontSize:10 }} onClick={() => move(i,-1)}>▲</button>
            <button style={{ ...S.btnSm, padding:"1px 5px", fontSize:10 }} onClick={() => move(i,1)}>▼</button>
          </div>
          <select value={sec.type} onChange={e => update(i, "type", e.target.value)}
            style={{ ...S.select, width:110, fontSize:12, padding:"4px 6px" }}>
            {SECTION_TYPES.map(t => <option key={t}>{t}</option>)}
          </select>
          <input value={sec.label} onChange={e => update(i, "label", e.target.value)}
            style={{ ...S.input, width:130, fontSize:12, padding:"4px 6px" }} placeholder="Label" />
          <input type="number" min={1} max={64} value={sec.measures}
            onChange={e => update(i, "measures", Math.max(1, parseInt(e.target.value)||8))}
            style={{ ...S.input, width:60, fontSize:12, padding:"4px 6px", textAlign:"center" }} />
          <span style={{ fontSize:10, color: C.muted, whiteSpace:"nowrap" }}>meas</span>
          <button style={{ ...S.btnDanger, padding:"3px 7px", fontSize:11, marginLeft:"auto" }}
            onClick={() => remove(i)}>✕</button>
        </div>
      ))}
    </div>
  );
}

// ─── SamplePanel ──────────────────────────────────────────────────────────────
function SamplePanel({ compId, totalMeasures, samples, onRefresh }) {
  const [urlForm, setUrlForm] = useState({
    name:"", source_url:"", layer_role:"sample",
    start_measure:1, end_measure:"", volume:1.0, loop:false,
  });
  const [uploading, setUploading] = useState(false);
  const [status, setStatus]       = useState("");
  const [error, setError]         = useState("");
  const fileRef = useRef();

  const LAYER_ROLES = ["sample","pad","loop","fx","vocal","drum_loop","bass_loop","melody_sample"];

  async function addUrl() {
    if (!urlForm.source_url) { setError("URL is required."); return; }
    setError("");
    try {
      await apiRequest(`/composer/compositions/${compId}/samples`, {
        method:"POST",
        body: JSON.stringify({
          name: urlForm.name || urlForm.source_url.split("/").pop(),
          source_type:"url",
          source_url: urlForm.source_url,
          layer_role: urlForm.layer_role,
          start_measure: urlForm.start_measure,
          end_measure: urlForm.end_measure ? parseInt(urlForm.end_measure) : null,
          volume: urlForm.volume,
          loop: urlForm.loop,
        }),
      });
      setStatus("Sample added.");
      onRefresh();
      setUrlForm({ name:"", source_url:"", layer_role:"sample", start_measure:1, end_measure:"", volume:1.0, loop:false });
    } catch(e) { setError(e.message); }
  }

  async function handleUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true); setError("");
    const fd = new FormData();
    fd.append("file", file);
    fd.append("layer_role", "sample");
    fd.append("start_measure", "1");
    fd.append("volume", "1.0");
    fd.append("loop", "false");
    try {
      const res = await fetch(`/composer/compositions/${compId}/samples/upload`, {
        method:"POST", body: fd, credentials: "include",
      });
      if (!res.ok) throw new Error(await res.text());
      setStatus(`Uploaded: ${file.name}`);
      onRefresh();
    } catch(e) { setError("Upload failed: " + e.message); }
    setUploading(false);
    e.target.value = "";
  }

  async function deleteSample(sampleId) {
    if (!confirm("Remove this sample?")) return;
    await apiRequest(`/composer/compositions/${compId}/samples/${sampleId}`, { method:"DELETE" });
    onRefresh();
  }

  async function updateSampleVol(sampleId, volume) {
    // Optimistic: just refresh; full PATCH would require a backend route
    setStatus("Volume changes will apply on next save.");
  }

  return (
    <div>
      {status && (
        <div style={{ background:"#1a2a1a", color:"#6aaa6a", padding:"7px 12px", borderRadius:6, marginBottom:10, fontSize:12 }}>
          ✓ {status}
        </div>
      )}
      {error && (
        <div style={{ background:"#2a1111", color:"#ffb3b3", padding:"7px 12px", borderRadius:6, marginBottom:10, fontSize:12 }}>
          ✗ {error}
        </div>
      )}

      {/* URL sample form */}
      <div style={{ ...S.card }}>
        <div style={{ fontSize:13, color: C.gold, fontWeight:700, marginBottom:12 }}>🔗 Add Public Sample via URL</div>
        <div style={S.row}>
          <div style={S.col}>
            <label style={S.label}>Name (optional)</label>
            <input style={S.input} value={urlForm.name} placeholder="e.g. Snare loop"
              onChange={e => setUrlForm(f => ({...f, name: e.target.value}))} />
          </div>
          <div style={{ ...S.col, flex:2 }}>
            <label style={S.label}>Public Audio URL (.wav / .mp3 / .ogg)</label>
            <input style={S.input} value={urlForm.source_url} placeholder="https://example.com/sample.wav"
              onChange={e => setUrlForm(f => ({...f, source_url: e.target.value}))} />
          </div>
        </div>
        <div style={S.row}>
          <div style={S.col}>
            <label style={S.label}>Layer Role</label>
            <select style={S.select} value={urlForm.layer_role}
              onChange={e => setUrlForm(f => ({...f, layer_role: e.target.value}))}>
              {LAYER_ROLES.map(r => <option key={r}>{r}</option>)}
            </select>
          </div>
          <div style={S.col}>
            <label style={S.label}>Start Measure</label>
            <input type="number" min={1} max={totalMeasures || 128} style={S.input}
              value={urlForm.start_measure}
              onChange={e => setUrlForm(f => ({...f, start_measure: parseInt(e.target.value)||1}))} />
          </div>
          <div style={S.col}>
            <label style={S.label}>End Measure (blank = full)</label>
            <input type="number" min={1} max={totalMeasures || 128} style={S.input}
              value={urlForm.end_measure} placeholder="—"
              onChange={e => setUrlForm(f => ({...f, end_measure: e.target.value}))} />
          </div>
          <div style={S.col}>
            <label style={S.label}>Volume (0–2)</label>
            <input type="number" min={0} max={2} step={0.05} style={S.input}
              value={urlForm.volume}
              onChange={e => setUrlForm(f => ({...f, volume: parseFloat(e.target.value)||1.0}))} />
          </div>
          <div style={{ display:"flex", alignItems:"flex-end", paddingBottom:2 }}>
            <label style={{ display:"flex", alignItems:"center", gap:6, fontSize:12, color: C.muted, cursor:"pointer", whiteSpace:"nowrap" }}>
              <input type="checkbox" checked={urlForm.loop}
                onChange={e => setUrlForm(f => ({...f, loop: e.target.checked}))} />
              Loop
            </label>
          </div>
        </div>
        <button style={S.btn} onClick={addUrl}>＋ Add URL Sample</button>
      </div>

      {/* Upload form */}
      <div style={{ ...S.card }}>
        <div style={{ fontSize:13, color: C.gold, fontWeight:700, marginBottom:10 }}>⬆ Upload Your Own Audio</div>
        <div style={{ display:"flex", alignItems:"center", gap:12 }}>
          <input ref={fileRef} type="file" accept="audio/*" style={{ display:"none" }}
            onChange={handleUpload} />
          <button style={{ ...S.btn, fontSize:12 }} onClick={() => fileRef.current?.click()} disabled={uploading}>
            {uploading ? "⏳ Uploading…" : "Choose Audio File"}
          </button>
          <span style={{ fontSize:11, color: C.muted }}>.wav · .mp3 · .ogg · .flac · .aiff — placed at measure 1 by default</span>
        </div>
      </div>

      {/* Sample list */}
      {samples.length > 0 ? (
        <div style={S.card}>
          <div style={{ fontSize:13, color: C.gold, fontWeight:700, marginBottom:12 }}>
            🎚 Layered Samples ({samples.length})
          </div>
          {/* Mini timeline header */}
          <div style={{ position:"relative", height:8, background: C.surface, borderRadius:4, marginBottom:12, overflow:"hidden" }}>
            {samples.map((s, i) => {
              const startPct = ((s.start_measure - 1) / (totalMeasures || 64)) * 100;
              const endPct   = s.end_measure
                ? (s.end_measure / (totalMeasures || 64)) * 100
                : 100;
              const colors = ["#C9A84C","#7ec8e3","#8adf9a","#e38a8a","#c8a0e3","#d4c083","#a083d4"];
              return (
                <div key={s.id} style={{
                  position:"absolute", top:0, height:"100%", borderRadius:4,
                  left:`${startPct}%`, width:`${endPct - startPct}%`,
                  background: colors[i % colors.length], opacity:0.7,
                }} title={`${s.name}: m${s.start_measure}–${s.end_measure || "end"}`}/>
              );
            })}
          </div>
          {samples.map(s => (
            <div key={s.id} style={{
              display:"flex", alignItems:"center", gap:10, padding:"10px 0",
              borderBottom:`1px solid ${C.border}`,
            }}>
              <div style={{ flex:1 }}>
                <div style={{ fontSize:13, color: C.text, fontWeight:600 }}>{s.name}</div>
                <div style={{ fontSize:11, color: C.muted, marginTop:2 }}>
                  {s.source_type === "url"
                    ? <span>🔗 <a href={s.source_url} target="_blank" rel="noreferrer"
                        style={{ color: C.muted, textDecoration:"none" }}>{s.source_url?.slice(0,60)}…</a></span>
                    : <span>📁 {s.file_path?.split("/").pop()}</span>}
                </div>
                <div style={{ fontSize:10, color: C.muted, marginTop:2 }}>
                  <span style={{ background: C.surface, padding:"1px 5px", borderRadius:3, marginRight:4 }}>{s.layer_role}</span>
                  m{s.start_measure}{s.end_measure ? `–${s.end_measure}` : "+"} ·
                  vol {s.volume}{s.loop ? " · 🔁 loop" : ""}
                </div>
              </div>
              <button style={{ ...S.btnDanger, fontSize:11, padding:"4px 8px" }}
                onClick={() => deleteSample(s.id)}>✕ Remove</button>
            </div>
          ))}
        </div>
      ) : (
        <div style={{ ...S.card, textAlign:"center", color: C.muted, padding:32 }}>
          No samples yet. Add a URL sample or upload an audio file above.
        </div>
      )}
    </div>
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

  return (
    <div style={{ display:"flex", userSelect:"none" }}>
      {/* Piano keyboard */}
      <div style={{ width:KEY_W, flexShrink:0, position:"sticky", left:0, zIndex:10, background:"#181410" }}>
        {Array.from({ length: totalRows }).map((_, i) => {
          const midi = midiHigh - i;
          const black = isBlack(midi);
          const noteName = NOTE_NAMES[midi % 12];
          const isC = midi % 12 === 0;
          return (
            <div key={midi} style={{
              height: CELL_H, display:"flex", alignItems:"center", justifyContent:"flex-end",
              paddingRight:4,
              background: black ? "#2a2020" : isC ? "#1e1a14" : "#181410",
              borderBottom: isC ? `1px solid ${C.border}` : `1px solid #221a14`,
              color: black ? "#554030" : isC ? C.gold : "#5a4030",
              fontSize:9, fontFamily:"monospace",
            }}>
              {(isC || noteName.length === 2) ? noteName + (Math.floor(midi / 12) - 1) : ""}
            </div>
          );
        })}
      </div>

      {/* Grid */}
      <div style={{ overflowX:"auto" }}>
        <div style={{ width: beats16 * CELL_W, position:"relative" }}>
          {Array.from({ length: totalRows }).map((_, i) => {
            const midi = midiHigh - i;
            const black = isBlack(midi);
            const isC = midi % 12 === 0;
            return (
              <div key={midi} style={{
                display:"flex", height: CELL_H,
                borderBottom: isC ? `1px solid ${C.border}` : `1px solid #1e1810`,
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
                        width: CELL_W - 1, height:"100%", flexShrink:0, marginRight:1,
                        marginLeft: beatStart && b > 0 ? 3 : 0,
                        background: on ? (eraseMode ? "#8b2222" : C.gold) : "transparent",
                        borderLeft: beatStart ? `1px solid ${C.border}` : groupStart ? `1px solid #221a14` : "none",
                        borderRadius: on ? 2 : 0,
                        cursor: eraseMode ? "cell" : "crosshair",
                      }}
                    />
                  );
                })}
              </div>
            );
          })}
          {/* Measure numbers */}
          <div style={{ position:"absolute", top:0, left:0, pointerEvents:"none", display:"flex" }}>
            {Array.from({ length: Math.ceil(beats16 / 16) }).map((_, m) => (
              <div key={m} style={{ width: 16 * CELL_W, fontSize:9, color: C.gold,
                paddingLeft:2, opacity:0.6, flexShrink:0 }}>M{m+1}</div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── ComposerOverlay ──────────────────────────────────────────────────────────
export default function ComposerOverlay({ onClose }) {
  const [tab, setTab]                   = useState("setup");
  const [compositions, setCompositions] = useState([]);
  const [activeComp, setActiveComp]     = useState(null);
  const [styleCatalog, setStyleCatalog] = useState({});
  const [showStyleBrowser, setShowStyleBrowser] = useState(false);
  const [styleTarget, setStyleTarget]   = useState(null);   // null = global, string = partId

  const [setupForm, setSetupForm] = useState({
    title:"New Piece", key:"C", mode:"major",
    tempo:120, time_signature:"4/4", measures:8, style:"neutral",
  });
  const [sections, setSections]   = useState([]);
  const [useSections, setUseSections] = useState(true);

  // { partId -> styleId } overrides
  const [styleOverrides, setStyleOverrides] = useState({});

  const [selectedParts, setSelectedParts]   = useState(["melody","harmony","bass"]);
  const [generatingPart, setGeneratingPart] = useState(null);
  const [saveStatus, setSaveStatus]         = useState("");
  const [error, setError]                   = useState("");
  const [isPlaying, setIsPlaying]           = useState(false);

  const [drumPattern, setDrumPattern] = useState(() => {
    const p = {};
    DRUM_ROWS.forEach(r => { p[r.id] = Array(16).fill(0); });
    return p;
  });

  const [pianoRollPart, setPianoRollPart]   = useState("melody");
  const [pianoRollCells, setPianoRollCells] = useState([]);
  const [pianoEraseMode, setPianoEraseMode] = useState(false);

  const PIANO_MIDI_LOW  = 36;
  const PIANO_MIDI_HIGH = 95;

  const totalMeasures =
    (activeComp?.sections?.length
      ? activeComp.sections.reduce((s, sec) => s + (sec.measures || 8), 0)
      : activeComp?.measures)
    || sections.reduce((s, sec) => s + (sec.measures || 8), 0)
    || setupForm.measures;

  const BEATS_16 = totalMeasures * 16;

  const allStylesFlat = Object.values(styleCatalog).flat();
  const currentGlobalStyle = setupForm.style;
  const styleLabel = s => allStylesFlat.find(x => x.id === s)?.description || s;

  // ── Bootstrap ──────────────────────────────────────────────────────────────
  useEffect(() => {
    apiRequest("/composer/compositions").then(setCompositions).catch(() => {});
    apiRequest("/composer/styles").then(r => setStyleCatalog(r.styles || {})).catch(() => {});
  }, []);

  useEffect(() => {
    if (useSections && sections.length === 0) {
      setSections([
        { type:"intro",  measures:4,  label:"Intro" },
        { type:"verse",  measures:8,  label:"Verse 1" },
        { type:"chorus", measures:8,  label:"Chorus" },
        { type:"verse",  measures:8,  label:"Verse 2" },
        { type:"chorus", measures:8,  label:"Chorus" },
        { type:"bridge", measures:4,  label:"Bridge" },
        { type:"chorus", measures:8,  label:"Final Chorus" },
        { type:"outro",  measures:4,  label:"Outro" },
      ]);
    }
    if (!useSections) {
      setSections([]);
    }
  }, [useSections]);  // eslint-disable-line react-hooks/exhaustive-deps

  // ── Helpers ────────────────────────────────────────────────────────────────
  function flash(msg) { setSaveStatus(msg); setTimeout(() => setSaveStatus(""), 4000); }

  function openStyleBrowser(targetPartId = null) {
    setStyleTarget(targetPartId);
    setShowStyleBrowser(true);
  }

  function handleStyleSelect(styleId) {
    if (styleTarget === null) {
      setSetupForm(f => ({ ...f, style: styleId }));
      // Also update active comp's display style
      if (activeComp) setActiveComp(c => ({ ...c, style: styleId }));
    } else {
      setStyleOverrides(prev => ({ ...prev, [styleTarget]: styleId }));
      flash(`Part style override set: ${styleLabel(styleId)}`);
    }
    setShowStyleBrowser(false);
  }

  function clearPartOverride(partId) {
    setStyleOverrides(prev => { const n = { ...prev }; delete n[partId]; return n; });
  }

  // ── Compositions ───────────────────────────────────────────────────────────
  async function createComposition() {
    setError("");
    try {
      const effectiveSections = useSections ? sections : [];
      const effectiveMeasures = useSections
        ? sections.reduce((s, sec) => s + (sec.measures || 8), 0)
        : setupForm.measures;
      const data = await apiRequest("/composer/compositions", {
        method:"POST",
        body: JSON.stringify({ ...setupForm, measures: effectiveMeasures, sections: effectiveSections }),
      });
      const full = await apiRequest(`/composer/compositions/${data.id}`);
      setActiveComp(full);
      setCompositions(prev => [data, ...prev]);
      if (full.sections?.length) setSections(full.sections);
      setSelectedParts(["melody","harmony","bass"]);
      if (full.drum_pattern) setDrumPattern(full.drum_pattern.pattern);
      flash("Composition created.");
      setTab("score");
    } catch(e) { setError(e.message); }
  }

  async function loadComposition(id) {
    setError("");
    try {
      const full = await apiRequest(`/composer/compositions/${id}`);
      setActiveComp(full);
      setSetupForm({
        title: full.title, key: full.key, mode: full.mode,
        tempo: full.tempo, time_signature: full.time_signature,
        measures: full.measures, style: full.style || "neutral",
      });
      if (full.sections?.length) { setSections(full.sections); setUseSections(true); }
      setSelectedParts(full.parts.map(p => p.role).length ? full.parts.map(p => p.role) : ["melody","harmony","bass"]);
      if (full.drum_pattern) setDrumPattern(full.drum_pattern.pattern);
      const pr = full.piano_rolls?.find(r => r.part_role === "melody");
      if (pr) setPianoRollCells(pr.cells);
      setTab("score");
    } catch(e) { setError(e.message); }
  }

  async function deleteComposition(id) {
    if (!confirm("Delete this composition? This cannot be undone.")) return;
    await apiRequest(`/composer/compositions/${id}`, { method:"DELETE" }).catch(() => {});
    setCompositions(prev => prev.filter(c => c.id !== id));
    if (activeComp?.id === id) { setActiveComp(null); setTab("setup"); }
  }

  // ── Generation ─────────────────────────────────────────────────────────────
  async function generatePart(role) {
    if (!activeComp) return;
    setGeneratingPart(role); setError("");
    try {
      const effectiveStyle = styleOverrides[role] || activeComp.style || "neutral";
      const endpoint = {
        harmony:        "/composer/generate/harmony",
        bass:           "/composer/generate/bass",
        drums:          "/composer/generate/drums",
      }[role] || "/composer/generate/melody";  // melody, counter_melody, other → melody

      const existingMelody = activeComp.parts.find(p => p.role === "melody")?.notes || [];
      const result = await apiRequest(endpoint, {
        method:"POST",
        body: JSON.stringify({
          key: activeComp.key, mode: activeComp.mode,
          measures: totalMeasures, tempo: activeComp.tempo,
          time_signature: activeComp.time_signature,
          existing_melody: existingMelody,
          style: effectiveStyle,
        }),
      });
      await apiRequest(`/composer/compositions/${activeComp.id}/parts`, {
        method:"POST", body: JSON.stringify({ role: result.role, notes: result.notes }),
      });
      const updated = await apiRequest(`/composer/compositions/${activeComp.id}`);
      setActiveComp(updated);
      flash(`✨ Generated ${role}${styleOverrides[role] ? ` (${styleLabel(styleOverrides[role])})` : ""}`);
    } catch(e) { setError(e.message); }
    finally { setGeneratingPart(null); }
  }

  async function generateFullSong() {
    if (!activeComp) return;
    setGeneratingPart("song"); setError("");
    try {
      const result = await apiRequest("/composer/generate/song", {
        method:"POST",
        body: JSON.stringify({
          key: activeComp.key, mode: activeComp.mode,
          measures: totalMeasures,
          tempo: activeComp.tempo,
          time_signature: activeComp.time_signature,
          style: activeComp.style || "neutral",
        }),
      });
      for (const [role, notes] of Object.entries(result.parts)) {
        await apiRequest(`/composer/compositions/${activeComp.id}/parts`, {
          method:"POST", body: JSON.stringify({ role, notes }),
        });
      }
      if (result.drum_pattern) {
        setDrumPattern(Object.fromEntries(
          Object.entries(result.drum_pattern).map(([k, v]) => [k, v.slice(0, 16)])
        ));
        await apiRequest(`/composer/compositions/${activeComp.id}/drum_pattern`, {
          method:"POST", body: JSON.stringify({ pattern: result.drum_pattern, steps:16, swing:0 }),
        });
      }
      const updated = await apiRequest(`/composer/compositions/${activeComp.id}`);
      setActiveComp(updated);
      if (result.sections?.length) setSections(result.sections);
      flash(`✨ Full song generated · ${result.total_measures} measures · ${result.sections?.length} sections`);
    } catch(e) { setError(e.message); }
    finally { setGeneratingPart(null); }
  }

  async function generateDrums() {
    if (!activeComp) return;
    setGeneratingPart("drums"); setError("");
    try {
      const result = await apiRequest("/composer/generate/drums", {
        method:"POST",
        body: JSON.stringify({
          time_signature: activeComp.time_signature,
          style: activeComp.style || "neutral",
          measures: 1,
        }),
      });
      setDrumPattern(result.pattern);
      flash("✨ Drum pattern generated");
    } catch(e) { setError(e.message); }
    finally { setGeneratingPart(null); }
  }

  async function saveDrumPattern() {
    if (!activeComp) return;
    try {
      await apiRequest(`/composer/compositions/${activeComp.id}/drum_pattern`, {
        method:"POST", body: JSON.stringify({ pattern: drumPattern, steps:16, swing:0 }),
      });
      flash("Drum pattern saved.");
    } catch(e) { setError(e.message); }
  }

  async function savePianoRoll() {
    if (!activeComp) return;
    try {
      await apiRequest(`/composer/compositions/${activeComp.id}/piano_roll`, {
        method:"POST", body: JSON.stringify({ part_role: pianoRollPart, cells: pianoRollCells }),
      });
      flash("Piano roll saved.");
    } catch(e) { setError(e.message); }
  }

  async function refreshSamples() {
    if (!activeComp) return;
    const updated = await apiRequest(`/composer/compositions/${activeComp.id}`);
    setActiveComp(updated);
  }

  function exportXml() {
    if (!activeComp) return;
    window.open(`/composer/compositions/${activeComp.id}/export_xml`, "_blank");
  }

  function toggleDrum(rowId, step) {
    setDrumPattern(prev => ({
      ...prev,
      [rowId]: prev[rowId].map((v, i) => i === step ? (v ? 0 : 1) : v),
    }));
  }

  function handlePianoCellInteract(midi, beat16) {
    const exists = pianoRollCells.some(c => c.pitch_midi === midi && c.beat_16th === beat16);
    if (pianoEraseMode || exists) {
      setPianoRollCells(prev => prev.filter(c => !(c.pitch_midi === midi && c.beat_16th === beat16)));
    } else {
      setPianoRollCells(prev => [...prev, {
        pitch_midi: midi, beat_16th: beat16, duration_16th:1,
        measure: Math.floor(beat16 / 16) + 1,
      }]);
    }
  }

  // ─── Render ────────────────────────────────────────────────────────────────
  return (
    <div style={S.overlay}>

      {/* Style browser modal */}
      {showStyleBrowser && (
        <StyleBrowser
          catalog={styleCatalog}
          currentStyle={styleTarget === null ? currentGlobalStyle : (styleOverrides[styleTarget] || currentGlobalStyle)}
          onSelect={handleStyleSelect}
          onClose={() => setShowStyleBrowser(false)}
        />
      )}

      {/* Header */}
      <div style={S.header}>
        <span style={{ fontSize:15, fontWeight:700, color: C.gold }}>♩ ScoreSync Composer</span>
        {["setup","score","drums","piano","samples"].map(t => (
          <button key={t} style={{ ...S.tab, ...(tab === t ? S.tabActive : {}) }} onClick={() => setTab(t)}>
            {{ setup:"Project", score:"Score Builder", drums:"Drum Machine", piano:"Piano Roll", samples:"Samples" }[t]}
          </button>
        ))}
        <div style={{ marginLeft:"auto", display:"flex", alignItems:"center", gap:8 }}>
          <button style={{ ...S.btnSm, fontSize:11, maxWidth:180, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}
            onClick={() => openStyleBrowser(null)} title="Change global style">
            🎨 {styleLabel(currentGlobalStyle)}
          </button>
          <button style={S.btnSm} onClick={onClose}>✕ Close</button>
        </div>
      </div>

      {/* Status banners */}
      {error && (
        <div style={{ background:"#2a1111", color:"#ffb3b3", padding:"7px 20px", fontSize:13,
                      display:"flex", justifyContent:"space-between", alignItems:"center", flexShrink:0 }}>
          <span>⚠ {error}</span>
          <button style={{ background:"none", border:"none", color:"#ffb3b3", cursor:"pointer", fontSize:16 }}
            onClick={() => setError("")}>✕</button>
        </div>
      )}
      {saveStatus && (
        <div style={{ background:"#1a2a1a", color:"#7acc7a", padding:"5px 20px", fontSize:12, flexShrink:0 }}>
          {saveStatus}
        </div>
      )}

      <div style={S.body}>

        {/* ══ PROJECT TAB ═══════════════════════════════════════════════════ */}
        {tab === "setup" && (
          <>
            <div style={S.card}>
              <div style={{ fontSize:14, color: C.gold, fontWeight:700, marginBottom:16 }}>
                New Composition
              </div>

              <div style={S.row}>
                <div style={{ ...S.col, flex:2 }}>
                  <label style={S.label}>Title</label>
                  <input style={S.input} value={setupForm.title}
                    onChange={e => setSetupForm(f => ({...f, title: e.target.value}))} />
                </div>
                <div style={S.col}>
                  <label style={S.label}>Key</label>
                  <select style={S.select} value={setupForm.key}
                    onChange={e => setSetupForm(f => ({...f, key: e.target.value}))}>
                    {KEYS.map(k => <option key={k}>{k}</option>)}
                  </select>
                </div>
                <div style={S.col}>
                  <label style={S.label}>Mode</label>
                  <select style={S.select} value={setupForm.mode}
                    onChange={e => setSetupForm(f => ({...f, mode: e.target.value}))}>
                    {MODES.map(m => <option key={m}>{m}</option>)}
                  </select>
                </div>
              </div>

              <div style={S.row}>
                <div style={S.col}>
                  <label style={S.label}>Tempo (BPM)</label>
                  <input style={S.input} type="number" min={40} max={320} value={setupForm.tempo}
                    onChange={e => setSetupForm(f => ({...f, tempo: parseInt(e.target.value)||120}))} />
                </div>
                <div style={S.col}>
                  <label style={S.label}>Time Signature</label>
                  <select style={S.select} value={setupForm.time_signature}
                    onChange={e => setSetupForm(f => ({...f, time_signature: e.target.value}))}>
                    {TIME_SIGS.map(t => <option key={t}>{t}</option>)}
                  </select>
                </div>
                {!useSections && (
                  <div style={S.col}>
                    <label style={S.label}>Measures (1–128)</label>
                    <input style={S.input} type="number" min={1} max={128} value={setupForm.measures}
                      onChange={e => setSetupForm(f => ({...f, measures: parseInt(e.target.value)||8}))} />
                  </div>
                )}
              </div>

              {/* Global style */}
              <div style={{ marginBottom:16 }}>
                <label style={S.label}>Global Style</label>
                <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                  <div style={{
                    flex:1, padding:"9px 14px", background: C.surface,
                    border:`1px solid ${C.border}`, borderRadius:6, fontSize:13,
                  }}>
                    <span style={{ color: C.gold, fontWeight:700 }}>{styleLabel(currentGlobalStyle)}</span>
                    {allStylesFlat.find(s => s.id === currentGlobalStyle) && (() => {
                      const sp = allStylesFlat.find(s => s.id === currentGlobalStyle);
                      return <span style={{ color: C.muted, marginLeft:10, fontSize:11 }}>
                        {sp.category} · {sp.tempo_range[0]}–{sp.tempo_range[1]} BPM · {sp.mode}
                      </span>;
                    })()}
                  </div>
                  <button style={{ ...S.btn, fontSize:12 }} onClick={() => openStyleBrowser(null)}>
                    🎨 Browse {Object.values(styleCatalog).flat().length || "…"} Styles
                  </button>
                </div>
              </div>

              {/* Parts */}
              <div style={{ marginBottom:16 }}>
                <label style={S.label}>Parts to include</label>
                <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
                  {PART_ROLES.map(role => (
                    <button key={role.id}
                      onClick={() => setSelectedParts(prev =>
                        prev.includes(role.id) ? prev.filter(r => r !== role.id) : [...prev, role.id]
                      )}
                      style={{
                        ...S.btnSm,
                        ...(selectedParts.includes(role.id) ? {
                          background: role.color + "22",
                          border: `1px solid ${role.color}`,
                          color: role.color,
                        } : {}),
                      }}>
                      {role.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Sections toggle */}
              <div style={{ marginBottom:14 }}>
                <label style={{ display:"flex", alignItems:"center", gap:8, cursor:"pointer", fontSize:13, color: C.text }}>
                  <input type="checkbox" checked={useSections}
                    onChange={e => { setUseSections(e.target.checked); if (!e.target.checked) setSections([]); }} />
                  Use song sections (intro / verse / chorus / bridge / outro)
                </label>
              </div>

              {useSections && (
                <div style={{ marginBottom:16 }}>
                  <SectionEditor sections={sections} onChange={setSections} />
                </div>
              )}

              <button style={{ ...S.btn, fontSize:14, padding:"10px 24px" }} onClick={createComposition}>
                ✦ Create Composition
              </button>
            </div>

            {/* Saved compositions */}
            {compositions.length > 0 && (
              <div style={S.card}>
                <div style={{ fontSize:14, color: C.gold, fontWeight:700, marginBottom:12 }}>Saved Compositions</div>
                {compositions.map(comp => (
                  <div key={comp.id} style={{
                    display:"flex", alignItems:"center", gap:10, padding:"10px 0",
                    borderBottom:`1px solid ${C.border}`,
                  }}>
                    <div style={{ flex:1 }}>
                      <div style={{ color: C.text, fontSize:13, fontWeight:700 }}>{comp.title}</div>
                      <div style={{ color: C.muted, fontSize:11 }}>
                        {comp.key} {comp.mode} · {comp.tempo} bpm ·{" "}
                        <span style={{ color: C.goldDim }}>{comp.style || "neutral"}</span>
                      </div>
                    </div>
                    <button style={S.btnSm} onClick={() => loadComposition(comp.id)}>Open</button>
                    <button style={S.btnDanger} onClick={() => deleteComposition(comp.id)}>Delete</button>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {/* ══ SCORE BUILDER TAB ═════════════════════════════════════════════ */}
        {tab === "score" && (
          !activeComp ? (
            <div style={{ color: C.muted, textAlign:"center", padding:60 }}>
              Create or open a composition in the <strong style={{ color: C.gold }}>Project</strong> tab to begin.
            </div>
          ) : (
            <>
              {/* Info bar */}
              <div style={{ ...S.card, display:"flex", alignItems:"center", gap:14, flexWrap:"wrap" }}>
                <div>
                  <div style={{ fontSize:16, color: C.gold, fontWeight:700 }}>{activeComp.title}</div>
                  <div style={{ fontSize:12, color: C.muted }}>
                    {activeComp.key} {activeComp.mode} · {activeComp.tempo} bpm ·{" "}
                    {activeComp.time_signature} · {totalMeasures} measures ·{" "}
                    <span style={{ color: C.gold }}>{styleLabel(activeComp.style || "neutral")}</span>
                  </div>
                </div>
                <div style={{ marginLeft:"auto", display:"flex", gap:8, flexWrap:"wrap" }}>
                  <button style={S.btnSm} onClick={() => openStyleBrowser(null)}>🎨 Style</button>
                  <button
                    style={{ ...S.btn, fontSize:12, padding:"6px 14px",
                      opacity: generatingPart === "song" ? 0.6 : 1 }}
                    disabled={!!generatingPart}
                    onClick={generateFullSong}>
                    {generatingPart === "song" ? "⏳ Generating…" : "✨ Generate Full Song"}
                  </button>
                  <button
                    style={{ ...S.btnSm,
                      ...(isPlaying ? { background:"#2a1111", color:"#ee5555" } : {}) }}
                    onClick={() => window.__playComposition?.(activeComp, setIsPlaying)}>
                    {isPlaying ? "⏹ Stop" : "▶ Play"}
                  </button>
                  <button style={S.btnSm} onClick={exportXml}>⬇ MusicXML</button>
                </div>
              </div>

              {/* Section strip */}
              {activeComp.sections?.length > 0 && (
                <div style={{ ...S.card, padding:"10px 14px" }}>
                  <div style={{ fontSize:11, color: C.muted, marginBottom:8 }}>Song Structure</div>
                  <div style={{ display:"flex", gap:5, flexWrap:"wrap" }}>
                    {activeComp.sections.map((sec, i) => (
                      <div key={i} style={{
                        padding:"4px 10px", borderRadius:5, fontSize:11,
                        background:{
                          intro:"#1a2015", verse:"#1a1520", chorus:"#201a15",
                          bridge:"#15201a", outro:"#1a1a20", instrumental:"#1a1a15",
                          "pre-chorus":"#181820", coda:"#201515",
                        }[sec.type] || C.surface,
                        border:`1px solid ${C.border}`, color: C.text,
                      }}>
                        <span style={{ opacity:0.7 }}>{sec.type.charAt(0).toUpperCase()}</span>{" "}
                        {sec.label}
                        <span style={{ color: C.muted, marginLeft:4 }}>({sec.measures}m)</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Part rows */}
              {PART_ROLES.filter(r => selectedParts.includes(r.id)).map(role => {
                const part = activeComp.parts?.find(p => p.role === role.id);
                const partStyle = styleOverrides[role.id];
                const partStyleLabel = partStyle ? styleLabel(partStyle) : null;

                return (
                  <div key={role.id} style={{ ...S.card, borderLeft:`3px solid ${role.color}` }}>
                    <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:8, flexWrap:"wrap" }}>
                      <span style={{ fontSize:13, color: role.color, fontWeight:700 }}>{role.label}</span>
                      {partStyleLabel && (
                        <span style={{
                          fontSize:10, background: role.color + "22",
                          color: role.color, padding:"2px 7px", borderRadius:3, fontWeight:600,
                        }}>
                          ✦ {partStyleLabel}
                        </span>
                      )}
                      <span style={{ fontSize:11, color: C.muted }}>
                        {part ? `${part.notes.length} notes` : "empty"}
                      </span>
                      <div style={{ marginLeft:"auto", display:"flex", gap:6, alignItems:"center", flexWrap:"wrap" }}>
                        <PartStyleBadge
                          partId={role.id}
                          styleOverrides={styleOverrides}
                          styleCatalog={styleCatalog}
                          onSetOverride={(pid, sid) => {
                            setStyleOverrides(prev => ({ ...prev, [pid]: sid }));
                            flash(`Part style: ${role.label} → ${styleLabel(sid)}`);
                          }}
                          onClearOverride={clearPartOverride}
                        />
                        <button
                          style={{ ...S.btnSm, opacity: !!generatingPart ? 0.5 : 1 }}
                          disabled={!!generatingPart}
                          onClick={() => generatePart(role.id)}>
                          {generatingPart === role.id ? "⏳…" : "✨ AI Generate"}
                        </button>
                        {part && (
                          <button style={{ ...S.btnSm, color:"#7ec8e3" }}
                            onClick={() => {
                              setPianoRollPart(role.id);
                              const pr = activeComp.piano_rolls?.find(r => r.part_role === role.id);
                              if (pr) setPianoRollCells(pr.cells);
                              setTab("piano");
                            }}>
                            Edit in Piano Roll
                          </button>
                        )}
                      </div>
                    </div>

                    {part && part.notes.length > 0 ? (
                      <ScoreStrip
                        notes={part.notes}
                        color={role.color}
                        totalMeasures={totalMeasures}
                        sections={activeComp.sections || []}
                      />
                    ) : (
                      <div style={{
                        fontSize:11, color: C.dimmer, padding:"10px 0",
                        borderTop:`1px dashed ${C.dimmer}`,
                      }}>
                        No notes yet — click AI Generate or draw in the Piano Roll.
                      </div>
                    )}
                  </div>
                );
              })}
            </>
          )
        )}

        {/* ══ DRUM MACHINE TAB ══════════════════════════════════════════════ */}
        {tab === "drums" && (
          <>
            <div style={{ ...S.card, display:"flex", alignItems:"center", gap:12, flexWrap:"wrap" }}>
              <div>
                <span style={{ color: C.gold, fontSize:14, fontWeight:700 }}>Drum Machine</span>
                <span style={{ color: C.muted, fontSize:12, marginLeft:10 }}>16th-note grid · 1-measure loop pattern</span>
              </div>
              <div style={{ marginLeft:"auto", display:"flex", gap:8 }}>
                <button style={S.btnSm} disabled={!!generatingPart} onClick={generateDrums}>
                  {generatingPart === "drums" ? "⏳…" : "✨ AI Suggest"}
                </button>
                <button style={S.btn} onClick={saveDrumPattern}>Save to Project</button>
              </div>
            </div>

            <div style={{ ...S.card, overflowX:"auto" }}>
              {/* Step numbers */}
              <div style={{ display:"flex", marginBottom:6, marginLeft:82 }}>
                {Array.from({ length: 16 }).map((_, i) => (
                  <div key={i} style={{
                    width:30, textAlign:"center", fontSize:10, flexShrink:0,
                    color: i % 4 === 0 ? C.gold : C.dimmer, fontFamily:"monospace",
                    marginLeft: i % 4 === 0 && i > 0 ? 6 : 2,
                  }}>{i + 1}</div>
                ))}
              </div>

              {DRUM_ROWS.map(row => (
                <div key={row.id} style={{ display:"flex", alignItems:"center", marginBottom:5 }}>
                  <div style={{ width:78, fontSize:12, color:row.color, textAlign:"right", paddingRight:8, flexShrink:0 }}>
                    {row.label}
                  </div>
                  {Array.from({ length: 16 }).map((_, step) => {
                    const on = drumPattern[row.id]?.[step] === 1;
                    const groupStart = step % 4 === 0 && step > 0;
                    return (
                      <div key={step} onClick={() => toggleDrum(row.id, step)} style={{
                        width:26, height:26, flexShrink:0, borderRadius:4, cursor:"pointer",
                        marginLeft: groupStart ? 8 : 2,
                        background: on ? row.color : C.surface,
                        border: on ? `1px solid ${row.color}` : `1px solid ${C.border}`,
                        boxShadow: on ? `0 0 6px ${row.color}55` : "none",
                        transition:"background 0.06s, box-shadow 0.06s",
                      }}/>
                    );
                  })}
                </div>
              ))}
            </div>
          </>
        )}

        {/* ══ PIANO ROLL TAB ════════════════════════════════════════════════ */}
        {tab === "piano" && (
          <>
            <div style={{ ...S.card, display:"flex", alignItems:"center", gap:10, flexWrap:"wrap" }}>
              <span style={{ color: C.gold, fontSize:14, fontWeight:700 }}>Piano Roll</span>
              <select style={{ ...S.select, width:160 }} value={pianoRollPart}
                onChange={e => {
                  setPianoRollPart(e.target.value);
                  const pr = activeComp?.piano_rolls?.find(r => r.part_role === e.target.value);
                  setPianoRollCells(pr ? pr.cells : []);
                }}>
                {PART_ROLES.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}
              </select>
              <button
                style={{
                  ...S.btnSm,
                  ...(pianoEraseMode ? { background:"#2a1111", color:"#ee5555", border:"1px solid #8b2222" } : {}),
                }}
                onClick={() => setPianoEraseMode(v => !v)}>
                {pianoEraseMode ? "🗑 Erase ON" : "✏ Draw"}
              </button>
              <button style={S.btnSm} onClick={() => setPianoRollCells([])}>Clear All</button>
              <span style={{ fontSize:11, color: C.muted }}>
                {pianoRollCells.length} notes · {totalMeasures} measures
              </span>
              <button
                style={{ ...S.btn, fontSize:12, padding:"6px 14px", marginLeft:"auto" }}
                onClick={savePianoRoll}>
                Save to Project
              </button>
            </div>

            <div style={{ ...S.card, padding:0, overflow:"hidden" }}>
              <div style={{ overflowX:"auto", overflowY:"auto", maxHeight:"calc(100vh - 260px)" }}>
                <PianoRollGrid
                  midiLow={PIANO_MIDI_LOW}
                  midiHigh={PIANO_MIDI_HIGH}
                  beats16={BEATS_16}
                  cells={pianoRollCells}
                  eraseMode={pianoEraseMode}
                  onCellInteract={handlePianoCellInteract}
                />
              </div>
            </div>
          </>
        )}

        {/* ══ SAMPLES TAB ═══════════════════════════════════════════════════ */}
        {tab === "samples" && (
          !activeComp ? (
            <div style={{ color: C.muted, textAlign:"center", padding:60 }}>
              Open a composition in the <strong style={{ color: C.gold }}>Project</strong> tab first.
            </div>
          ) : (
            <SamplePanel
              compId={activeComp.id}
              totalMeasures={totalMeasures}
              samples={activeComp.samples || []}
              onRefresh={refreshSamples}
            />
          )
        )}

      </div>
    </div>
  );
}
