import { useEffect, useRef, useState } from "react";

async function apiRequest(path, options = {}) {
  const isFormData = options.body instanceof FormData;
  const response = await fetch(path, {
    credentials: "include",
    headers: isFormData ? (options.headers || {}) : { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  if (response.status === 204) return null;
  const text = await response.text();
  let payload = null;
  try { payload = text ? JSON.parse(text) : null; } catch { payload = text; }
  if (!response.ok) {
    const detail = payload?.detail || payload?.message || payload || response.statusText;
    throw new Error(Array.isArray(detail) ? detail.map((d) => d.msg || d).join(", ") : String(detail));
  }
  return payload;
}

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const SUPPORTED_TYPES = ".pdf,.xml,.musicxml,.mxl,.mscz,.mscx";

function fileKind(file) {
  const ext = file.name.split(".").pop()?.toLowerCase();
  if (ext === "pdf") return "pdf";
  if (["xml", "musicxml", "mxl"].includes(ext)) return "musicxml";
  if (["mscz", "mscx"].includes(ext)) return "musescore";
  return "unknown";
}

function extractInfo(xml) {
  const tempo = Number(xml.match(/<per-minute>(\d+)<\/per-minute>/)?.[1] || 120);
  const beats = xml.match(/<beats>(\d+)<\/beats>/)?.[1] || "4";
  const beatType = xml.match(/<beat-type>(\d+)<\/beat-type>/)?.[1] || "4";
  const notes = (xml.match(/<note\b/g) || []).length;
  const rests = (xml.match(/<rest\b/g) || []).length;
  return { tempo, timeSignature: `${beats}/${beatType}`, notes, rests };
}

function analyzeMarkings(xml) {
  const items = [];
  const measures = xml.match(/<measure[^>]*number="([^"]*)"[^>]*>[\s\S]*?<\/measure>/g) || [];
  measures.forEach((measure, idx) => {
    const number = measure.match(/number="([^"]*)"/)?.[1] || String(idx + 1);
    if (measure.includes("<fermata")) items.push({ measure: number, label: "Fermata" });
    if (measure.includes("<staccato")) items.push({ measure: number, label: "Staccato" });
    if (measure.includes("<accent")) items.push({ measure: number, label: "Accent" });
    if (measure.includes("<tenuto")) items.push({ measure: number, label: "Tenuto" });
    if (measure.includes("<rest")) items.push({ measure: number, label: "Rest" });
  });
  return items;
}

function freqToNote(freq) {
  if (!freq || freq < 20) return "—";
  const midi = Math.round(69 + 12 * Math.log2(freq / 440));
  return `${NOTE_NAMES[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;
}

function AuthScreen({ onAuthed }) {
  const [mode, setMode] = useState("login");
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const [error, setError] = useState("");

  const submit = async () => {
    setError("");
    try {
      const endpoint = mode === "login" ? "/auth/login" : "/auth/register";
      const body = mode === "login" ? { email: form.email, password: form.password } : form;
      await apiRequest(endpoint, { method: "POST", body: JSON.stringify(body) });
      const me = await apiRequest("/auth/me").catch(() => ({ email: form.email, name: form.name }));
      onAuthed(me);
    } catch (err) {
      setError(err.message || "Authentication failed.");
    }
  };

  return (
    <div style={styles.centerPage}>
      <div className="glass" style={styles.authCard}>
        <h1 style={{ marginTop: 0 }}>ScoreSync</h1>
        <p style={styles.muted}>{mode === "login" ? "Sign in to view and edit your scores." : "Create an account to save your score workspace."}</p>
        {mode === "signup" && <input style={styles.input} placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />}
        <input style={styles.input} placeholder="Email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        <input style={styles.input} placeholder="Password" type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
        {error && <div style={styles.error}>{error}</div>}
        <button onClick={submit}>{mode === "login" ? "Sign In" : "Create Account"}</button>
        <button style={styles.linkButton} onClick={() => { setMode(mode === "login" ? "signup" : "login"); setError(""); }}>
          {mode === "login" ? "Need an account? Sign up" : "Have an account? Sign in"}
        </button>
      </div>
    </div>
  );
}

function StickyNote({ note, onUpdate, onDelete }) {
  return (
    <div style={{ ...styles.sticky, left: note.x, top: note.y }} onClick={(e) => e.stopPropagation()}>
      <textarea value={note.text} placeholder="Note..." onChange={(e) => onUpdate(note.id, { text: e.target.value })} style={styles.stickyText} />
      <button style={styles.smallButton} onClick={() => onDelete(note.id)}>Delete</button>
    </div>
  );
}

function ScoreWorkspace({ score, scoreType, xmlText, setXmlText, osmdLoaded, osmdError, osmdContainerRef, scoreContainerRef, stickyMode, notes, setNotes }) {
  const addNote = (event) => {
    if (!stickyMode || !scoreContainerRef.current) return;
    const rect = scoreContainerRef.current.getBoundingClientRect();
    setNotes((prev) => [...prev, { id: Date.now(), x: event.clientX - rect.left + scoreContainerRef.current.scrollLeft, y: event.clientY - rect.top + scoreContainerRef.current.scrollTop, text: "" }]);
  };

  return (
    <div ref={scoreContainerRef} onClick={addNote} style={styles.scoreCanvas}>
      {!score && scoreType !== "musescore" && <div style={styles.emptyState}>Upload a score to begin viewing and editing.</div>}
      {score && scoreType === "pdf" && <iframe src={score} title="Uploaded PDF Score" style={styles.pdfFrame} />}
      {score && scoreType === "musicxml" && (
        <>
          {osmdError && <div style={styles.error}>{osmdError}</div>}
          {!osmdLoaded && <div style={styles.emptyState}>Loading notation renderer…</div>}
          <div ref={osmdContainerRef} style={styles.osmdContainer} />
          <details style={{ marginTop: 16 }}>
            <summary>Edit raw MusicXML</summary>
            <textarea value={xmlText} onChange={(e) => setXmlText(e.target.value)} style={styles.xmlEditor} />
          </details>
        </>
      )}
      {scoreType === "musescore" && <div style={styles.emptyState}>MuseScore file uploaded. Download or convert to MusicXML/PDF for full rendering in this browser.</div>}
      {notes.map((note) => <StickyNote key={note.id} note={note} onUpdate={(id, changes) => setNotes((prev) => prev.map((n) => n.id === id ? { ...n, ...changes } : n))} onDelete={(id) => setNotes((prev) => prev.filter((n) => n.id !== id))} />)}
    </div>
  );
}

export default function App() {
  const [authLoading, setAuthLoading] = useState(true);
  const [user, setUser] = useState(null);
  const [score, setScore] = useState(null);
  const [scoreType, setScoreType] = useState(null);
  const [fileName, setFileName] = useState("");
  const [xmlText, setXmlText] = useState("");
  const [info, setInfo] = useState(null);
  const [markings, setMarkings] = useState([]);
  const [stickyMode, setStickyMode] = useState(false);
  const [notes, setNotes] = useState([]);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [isPracticing, setIsPracticing] = useState(false);
  const [micActive, setMicActive] = useState(false);
  const [currentFreq, setCurrentFreq] = useState(0);
  const [osmdLoaded, setOsmdLoaded] = useState(false);
  const [osmdError, setOsmdError] = useState("");
  const fileInputRef = useRef(null);
  const scoreContainerRef = useRef(null);
  const osmdContainerRef = useRef(null);
  const osmdRef = useRef(null);
  const streamRef = useRef(null);
  const meterRef = useRef(null);
  const audioContextRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    apiRequest("/auth/me")
      .then((me) => { if (!cancelled) setUser(me); })
      .catch(() => null)
      .finally(() => { if (!cancelled) setAuthLoading(false); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const script = document.createElement("script");
    script.src = "https://cdnjs.cloudflare.com/ajax/libs/opensheetmusicdisplay/1.8.6/opensheetmusicdisplay.min.js";
    script.onload = () => setOsmdLoaded(true);
    script.onerror = () => setOsmdError("Could not load OpenSheetMusicDisplay.");
    document.head.appendChild(script);
    return () => document.head.removeChild(script);
  }, []);

  useEffect(() => {
    if (!osmdLoaded || scoreType !== "musicxml" || !xmlText || !osmdContainerRef.current) return;
    osmdContainerRef.current.innerHTML = "";
    setOsmdError("");
    const OSMD = window.opensheetmusicdisplay?.OpenSheetMusicDisplay;
    if (!OSMD) { setOsmdError("Notation renderer is unavailable."); return; }
    const osmd = new OSMD(osmdContainerRef.current, { autoResize: true, drawTitle: true });
    osmdRef.current = osmd;
    osmd.load(xmlText).then(() => { osmd.render(); osmd.cursor?.show?.(); }).catch((err) => setOsmdError(`Could not render score: ${err.message}`));
  }, [osmdLoaded, scoreType, xmlText]);

  const persistUpload = async (file) => {
    const form = new FormData();
    form.append("file", file);
    await fetch("/scores/upload", { method: "POST", credentials: "include", body: form }).catch(() => null);
  };

  const handleFileLoad = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setError("");
    setMessage("");
    const kind = fileKind(file);
    setFileName(file.name);
    setScoreType(kind);
    setNotes([]);
    setMarkings([]);
    setInfo(null);
    setOsmdError("");
    try {
      if (kind === "pdf") {
        setScore(URL.createObjectURL(file));
        setXmlText("");
      } else if (kind === "musicxml") {
        const text = await file.text();
        setScore(text);
        setXmlText(text);
        setInfo(extractInfo(text));
        setMarkings(analyzeMarkings(text));
      } else if (kind === "musescore") {
        setScore(file);
        setXmlText("");
      } else {
        throw new Error(`Unsupported file type. Use ${SUPPORTED_TYPES}`);
      }
      persistUpload(file);
      setMessage(`${file.name} loaded. You can now view and edit annotations.`);
    } catch (err) {
      setError(err.message || "Could not load score.");
    } finally {
      event.target.value = "";
    }
  };

  const startPractice = async () => {
    setError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      setMicActive(true);
      setIsPracticing(true);
      setMessage("Practice started. Microphone is active.");
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      audioContextRef.current = ctx;
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      const source = ctx.createMediaStreamSource(stream);
      source.connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);
      const tick = () => {
        analyser.getByteFrequencyData(data);
        let max = 0, idx = 0;
        data.forEach((value, i) => { if (value > max) { max = value; idx = i; } });
        setCurrentFreq(max > 10 ? idx * ctx.sampleRate / analyser.fftSize : 0);
        meterRef.current = requestAnimationFrame(tick);
      };
      tick();
    } catch {
      setError("Microphone access denied or unavailable.");
    }
  };

  const stopPractice = () => {
    if (meterRef.current) cancelAnimationFrame(meterRef.current);
    streamRef.current?.getTracks?.().forEach((track) => track.stop());
    audioContextRef.current?.close?.();
    streamRef.current = null;
    audioContextRef.current = null;
    setMicActive(false);
    setIsPracticing(false);
    setCurrentFreq(0);
    setMessage("Practice stopped.");
  };

  const logout = async () => {
    stopPractice();
    await apiRequest("/auth/logout", { method: "POST" }).catch(() => null);
    setUser(null);
  };

  if (authLoading) return <div style={styles.centerPage}><div className="glass" style={styles.authCard}>Loading ScoreSync…</div></div>;
  if (!user) return <AuthScreen onAuthed={setUser} />;

  return (
    <div style={styles.app}>
      <input ref={fileInputRef} type="file" accept={SUPPORTED_TYPES} onChange={handleFileLoad} style={{ display: "none" }} />
      <header style={styles.header}>
        <div><h2 style={{ margin: 0 }}>Score Reader</h2><div style={styles.muted}>{fileName || "No score loaded"}</div></div>
        <div style={styles.buttonRow}>
          <button onClick={() => fileInputRef.current?.click()}>Upload Score</button>
          <button onClick={isPracticing ? stopPractice : startPractice}>{isPracticing ? "Stop Practice" : "Start Practice"}</button>
          <button onClick={() => setStickyMode((value) => !value)}>{stickyMode ? "Disable Notes" : "Add Notes"}</button>
          <button onClick={() => osmdRef.current?.cursor?.next?.()} disabled={scoreType !== "musicxml"}>Next Measure</button>
          <button onClick={logout}>Logout</button>
        </div>
      </header>

      {(message || error) && <div style={error ? styles.error : styles.notice}>{error || message}</div>}

      <div style={styles.grid}>
        <main className="glass" style={{ padding: 16, minWidth: 0 }}>
          <ScoreWorkspace score={score} scoreType={scoreType} xmlText={xmlText} setXmlText={setXmlText} osmdLoaded={osmdLoaded} osmdError={osmdError} osmdContainerRef={osmdContainerRef} scoreContainerRef={scoreContainerRef} stickyMode={stickyMode} notes={notes} setNotes={setNotes} />
        </main>
        <aside className="glass" style={styles.sidebar}>
          <h3>Practice</h3>
          <p>Status: <strong>{isPracticing ? "Active" : "Ready"}</strong></p>
          <p>Mic: <strong>{micActive ? "On" : "Off"}</strong></p>
          <p>Pitch: <strong>{freqToNote(currentFreq)}</strong></p>
          <h3>Score Info</h3>
          {info ? <><p>Tempo: {info.tempo} BPM</p><p>Time: {info.timeSignature}</p><p>Notes: {info.notes}</p><p>Rests: {info.rests}</p></> : <p style={styles.muted}>Upload MusicXML for score analysis.</p>}
          <h3>Markings</h3>
          {markings.length ? markings.map((m, i) => <div key={i} style={styles.marking}>M. {m.measure}: {m.label}</div>) : <p style={styles.muted}>No markings found yet.</p>}
          <h3>Annotations</h3>
          <p>{notes.length} sticky note{notes.length === 1 ? "" : "s"}</p>
        </aside>
      </div>
    </div>
  );
}

const styles = {
  app: { display: "grid", gap: 16 },
  centerPage: { minHeight: "70vh", display: "grid", placeItems: "center", padding: 24 },
  authCard: { width: "min(100%, 420px)", padding: 28, display: "grid", gap: 12 },
  header: { display: "flex", gap: 16, justifyContent: "space-between", alignItems: "center", flexWrap: "wrap" },
  buttonRow: { display: "flex", gap: 8, flexWrap: "wrap" },
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 320px), 1fr))", gap: 16 },
  sidebar: { padding: 16, alignSelf: "start" },
  scoreCanvas: { position: "relative", minHeight: "72vh", overflow: "auto", background: "#fff", color: "#111", borderRadius: 12, padding: 16 },
  emptyState: { minHeight: "58vh", display: "grid", placeItems: "center", color: "#777", textAlign: "center", padding: 24 },
  pdfFrame: { width: "100%", height: "78vh", border: 0, borderRadius: 8, background: "#fff" },
  osmdContainer: { width: "100%", minHeight: "60vh", background: "#fff" },
  xmlEditor: { width: "100%", minHeight: 260, marginTop: 12, fontFamily: "monospace", fontSize: 12 },
  sticky: { position: "absolute", width: 180, minHeight: 120, background: "#fff59d", color: "#111", border: "1px solid #d6c74a", borderRadius: 8, padding: 8, boxShadow: "0 8px 24px rgba(0,0,0,0.2)", zIndex: 5 },
  stickyText: { width: "100%", minHeight: 76, border: 0, background: "transparent", resize: "vertical", color: "#111" },
  smallButton: { fontSize: 12, padding: "4px 8px" },
  input: { padding: 12, borderRadius: 10, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)" },
  muted: { color: "var(--text-muted)" },
  error: { padding: 12, borderRadius: 10, background: "rgba(239,68,68,0.14)", color: "#fca5a5", border: "1px solid rgba(239,68,68,0.3)" },
  notice: { padding: 12, borderRadius: 10, background: "rgba(16,185,129,0.14)", color: "var(--success)", border: "1px solid rgba(16,185,129,0.28)" },
  linkButton: { background: "transparent", border: "none", color: "var(--accent)", boxShadow: "none" },
  marking: { padding: "6px 0", borderBottom: "1px solid var(--border)" },
};
