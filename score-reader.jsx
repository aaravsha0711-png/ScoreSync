import { useState, useEffect, useRef, useCallback } from "react";
 
// ─── Constants ────────────────────────────────────────────────────────────────
 
const NOTE_NAMES = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];
 
const MAJOR_SCALES = [
  { name: "C Major", root: 0, notes: [0,2,4,5,7,9,11] },
  { name: "G Major", root: 7, notes: [7,9,11,0,2,4,6] },
  { name: "D Major", root: 2, notes: [2,4,6,7,9,11,1] },
  { name: "A Major", root: 9, notes: [9,11,1,2,4,6,8] },
  { name: "E Major", root: 4, notes: [4,6,8,9,11,1,3] },
  { name: "B Major", root: 11, notes: [11,1,3,4,6,8,10] },
  { name: "F# Major", root: 6, notes: [6,8,10,11,1,3,5] },
  { name: "Db Major", root: 1, notes: [1,3,5,6,8,10,0] },
  { name: "Ab Major", root: 8, notes: [8,10,0,1,3,5,7] },
  { name: "Eb Major", root: 3, notes: [3,5,7,8,10,0,2] },
  { name: "Bb Major", root: 10, notes: [10,0,2,3,5,7,9] },
  { name: "F Major", root: 5, notes: [5,7,9,10,0,2,4] },
];
 
const MEYER_SCALES = NOTE_NAMES.map((n, i) => [
  { name: `${n} Meyer (v1)`, root: i, notes: [i,(i+2)%12,(i+4)%12,(i+6)%12,(i+7)%12,(i+9)%12,(i+11)%12] },
  { name: `${n} Meyer (v2)`, root: i, notes: [i,(i+2)%12,(i+3)%12,(i+6)%12,(i+7)%12,(i+9)%12,(i+11)%12] },
  { name: `${n} Meyer (v3)`, root: i, notes: [i,(i+2)%12,(i+4)%12,(i+6)%12,(i+8)%12,(i+9)%12,(i+11)%12] },
]).flat();
 
// Transposition offsets in semitones (written→concert)
const TRANSPOSITIONS = {
  "Concert (C)": 0,
  "Bb Trumpet": -2,
  "Bb Clarinet": -2,
  "Bb Tenor Sax": -14,
  "Bb Soprano Sax": -2,
  "Eb Alto Sax": 3,
  "Eb Baritone Sax": -9,
  "F Horn": -7,
  "Eb Trumpet": 3,
  "Bass Clarinet (Bb)": -14,
  "Flute": 0,
  "Oboe": 0,
  "Bassoon": 0,
  "Violin": 0,
  "Viola": 0,
  "Cello": 0,
  "Double Bass": 0,
  "Piano": 0,
  "Guitar": 0,
  "Tuba": 0,
  "Trombone": 0,
  "Euphonium": 0,
};
 
// ─── Pitch Detection (YIN algorithm) ─────────────────────────────────────────
 
function yin(buffer, sampleRate) {
  const W = buffer.length;
  const half = Math.floor(W / 2);
  const d = new Float32Array(half);
  d[0] = 1;
  let runSum = 0;
  for (let tau = 1; tau < half; tau++) {
    let s = 0;
    for (let i = 0; i < half; i++) {
      const diff = buffer[i] - buffer[i + tau];
      s += diff * diff;
    }
    d[tau] = s;
    runSum += s;
    d[tau] = runSum === 0 ? 0 : (d[tau] * tau) / runSum;
  }
  const threshold = 0.1;
  for (let tau = 2; tau < half; tau++) {
    if (d[tau] < threshold) {
      while (tau + 1 < half && d[tau + 1] < d[tau]) tau++;
      if (tau === 0) return -1;
      const x0 = tau === 0 ? tau : tau - 1;
      const x2 = tau + 1 < half ? tau + 1 : tau;
      if (x0 === tau) return sampleRate / (d[tau] <= d[x2] ? tau : x2);
      if (x2 === tau) return sampleRate / (d[tau] <= d[x0] ? tau : x0);
      const s0 = d[x0], s1 = d[tau], s2 = d[x2];
      const interp = tau + (s2 - s0) / (2 * (2 * s1 - s2 - s0));
      return sampleRate / interp;
    }
  }
  return -1;
}
 
function freqToMidi(freq) {
  if (freq <= 0) return null;
  return Math.round(69 + 12 * Math.log2(freq / 440));
}
 
function midiToNoteName(midi) {
  return NOTE_NAMES[((midi % 12) + 12) % 12];
}
 
function freqToNoteLabel(freq) {
  const midi = freqToMidi(freq);
  if (!midi) return null;
  const octave = Math.floor(midi / 12) - 1;
  return `${midiToNoteName(midi)}${octave}`;
}
 
function centsDiff(freq, midi) {
  if (!midi || freq <= 0) return 0;
  const refFreq = 440 * Math.pow(2, (midi - 69) / 12);
  return 1200 * Math.log2(freq / refFreq);
}
 
// ─── Stylistic Marking Analyzer (local heuristic) ────────────────────────────
 
function analyzeMarkings(mxmlText) {
  if (!mxmlText) return [];
  const results = [];
  const dynamics = mxmlText.match(/<dynamics[^>]*>[\s\S]*?<\/dynamics>/g) || [];
  if (dynamics.length) results.push({ type: "Dynamics", count: dynamics.length, detail: "p, f, mf, etc." });
  const slurs = (mxmlText.match(/<slur/g) || []).length;
  if (slurs) results.push({ type: "Slurs/Phrases", count: slurs, detail: "Legato connections" });
  const words = mxmlText.match(/<words[^>]*>([^<]+)<\/words>/g) || [];
  if (words.length) results.push({ type: "Text Markings", count: words.length, detail: words.slice(0,3).map(w=>w.replace(/<[^>]+>/g,"")).join(", ") });
  const tempo = mxmlText.match(/<metronome[\s\S]*?<\/metronome>/g) || [];
  if (tempo.length) results.push({ type: "Tempo Marks", count: tempo.length, detail: "Metronome markings found" });
  const hairpins = (mxmlText.match(/<wedge/g) || []).length;
  if (hairpins) results.push({ type: "Hairpins", count: hairpins, detail: "Crescendo / Decrescendo" });
  return results;
}
 
function extractScoreNoteNames(mxmlText) {
  const notes = new Set();
  const pitchBlocks = mxmlText.match(/<pitch>[\s\S]*?<\/pitch>/g) || [];
  for (const pitch of pitchBlocks) {
    const step = pitch.match(/<step>([^<]+)<\/step>/);
    const alter = pitch.match(/<alter>([^<]+)<\/alter>/);
    if (step) {
      let note = step[1];
      if (alter) {
        note += alter[1] === "1" ? "#" : alter[1] === "-1" ? "b" : "";
      }
      notes.add(note);
    }
  }
  return Array.from(notes);
}
 
function extractRestAlerts(mxmlText) {
  const restAlerts = [];
  const measureRegex = /<measure[^>]*number="([^\"]*)"[^>]*>([\s\S]*?)<\/measure>/g;
  let match;
  while ((match = measureRegex.exec(mxmlText))) {
    const measureNumber = parseInt(match[1], 10) || null;
    const body = match[2];
    if (measureNumber && /<rest\b/.test(body)) {
      restAlerts.push({ measure: measureNumber, restCount: (body.match(/<rest\b/g) || []).length });
    }
  }
  return restAlerts;
}

function generateMarkingSuggestions(currentMeasure, rhythmInfo, complexMarkings) {
  const suggestions = [];
  
  // Check for dynamic markings
  const hasDynamics = complexMarkings.some(m => m.type === "dynamics");
  if (!hasDynamics && currentMeasure % 4 === 1) {
    suggestions.push({
      type: "dynamics",
      suggestion: "Consider adding dynamic markings (p, f, mf) to indicate volume changes",
      measure: currentMeasure
    });
  }
  
  // Check for articulation
  const hasArticulation = complexMarkings.some(m => m.type === "articulation" && Math.abs(m.measure - currentMeasure) <= 2);
  if (!hasArticulation && currentMeasure % 2 === 0) {
    suggestions.push({
      type: "articulation", 
      suggestion: "Add staccato or legato markings to clarify note connection",
      measure: currentMeasure
    });
  }
  
  // Check for tempo changes
  const hasTempoChange = complexMarkings.some(m => m.type === "tempo");
  if (!hasTempoChange && currentMeasure > 8 && currentMeasure % 8 === 0) {
    suggestions.push({
      type: "tempo",
      suggestion: "Consider a ritardando or accelerando to add musical expression",
      measure: currentMeasure
    });
  }
  
  return suggestions;
}

function startVoiceRecognition(onMeasureDetected) {
  if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
    alert('Speech recognition not supported in this browser');
    return null;
  }
  
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const recognition = new SpeechRecognition();
  
  recognition.continuous = true;
  recognition.interimResults = false;
  recognition.lang = 'en-US';
  
  recognition.onresult = (event) => {
    const last = event.results.length - 1;
    const transcript = event.results[last][0].transcript.toLowerCase().trim();
    
    // Look for measure numbers (e.g., "measure 5", "go to measure 12", "measure twelve")
    const measureMatch = transcript.match(/(?:measure|go to measure)\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)/i);
    
    if (measureMatch) {
      const numberWord = measureMatch[1].toLowerCase();
      const numberMap = {
        'one': 1, 'two': 2, 'three': 3, 'four': 4, 'five': 5, 'six': 6, 'seven': 7, 'eight': 8, 'nine': 9, 'ten': 10,
        'eleven': 11, 'twelve': 12, 'thirteen': 13, 'fourteen': 14, 'fifteen': 15, 'sixteen': 16, 'seventeen': 17, 'eighteen': 18, 'nineteen': 19, 'twenty': 20
      };
      
      const measureNumber = numberMap[numberWord] || parseInt(numberWord);
      if (measureNumber && measureNumber > 0) {
        onMeasureDetected(measureNumber);
      }
    }
  };
  
  recognition.onerror = (event) => {
    console.error('Speech recognition error:', event.error);
  };
  
  recognition.start();
  return recognition;
}
 
// ─── Mock DB (localStorage) ───────────────────────────────────────────────────
 
function dbGet(key) { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } }
function dbSet(key, val) { localStorage.setItem(key, JSON.stringify(val)); }
 
function getUsers() { return dbGet("sr_users") || {}; }
function saveUsers(u) { dbSet("sr_users", u); }
 
function getProfile(email) { return dbGet(`sr_profile_${email}`) || { instrument: "Concert (C)", calibration: null }; }
function saveProfile(email, p) { dbSet(`sr_profile_${email}`, p); }
 
// ─── App ──────────────────────────────────────────────────────────────────────
 
export default function App() {
  const [screen, setScreen] = useState("auth"); // auth | calibrate | main
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [authMode, setAuthMode] = useState("login");
  const [authForm, setAuthForm] = useState({ email: "", password: "", name: "" });
  const [authError, setAuthError] = useState("");
 
  function handleLogin() {
    const users = getUsers();
    if (!users[authForm.email]) { setAuthError("No account found. Sign up first."); return; }
    if (users[authForm.email].password !== authForm.password) { setAuthError("Wrong password."); return; }
    const p = getProfile(authForm.email);
    setUser({ email: authForm.email, name: users[authForm.email].name });
    setProfile(p);
    setScreen(p.calibration ? "main" : "instrument");
    setAuthError("");
  }
 
  function handleSignup() {
    if (!authForm.email || !authForm.password || !authForm.name) { setAuthError("All fields required."); return; }
    const users = getUsers();
    if (users[authForm.email]) { setAuthError("Email already registered."); return; }
    users[authForm.email] = { name: authForm.name, password: authForm.password };
    saveUsers(users);
    const p = { instrument: "Concert (C)", calibration: null };
    saveProfile(authForm.email, p);
    setUser({ email: authForm.email, name: authForm.name });
    setProfile(p);
    setScreen("instrument");
    setAuthError("");
  }
 
  function handleLogout() {
    setUser(null); setProfile(null); setScreen("auth");
  }
 
  function handleInstrumentSave(instr) {
    const p = { ...profile, instrument: instr };
    saveProfile(user.email, p);
    setProfile(p);
    setScreen("calibrate");
  }
 
  function handleCalibrationDone(calibration) {
    const p = { ...profile, calibration };
    saveProfile(user.email, p);
    setProfile(p);
    setScreen("main");
  }
 
  function handleSkipCalibration() {
    const p = { ...profile, calibration: { skipped: true } };
    saveProfile(user.email, p);
    setProfile(p);
    setScreen("main");
  }
 
  if (screen === "auth") return <AuthScreen mode={authMode} form={authForm} error={authError}
    onFormChange={f => setAuthForm(f)} onLogin={handleLogin} onSignup={handleSignup}
    onToggleMode={() => { setAuthMode(m => m === "login" ? "signup" : "login"); setAuthError(""); }} />;
 
  if (screen === "instrument") return <InstrumentScreen onSave={handleInstrumentSave} />;
 
  if (screen === "calibrate") return <CalibrationScreen instrument={profile.instrument}
    onDone={handleCalibrationDone} onSkip={handleSkipCalibration} />;
 
  return <MainScreen user={user} profile={profile}
    onLogout={handleLogout} onRecalibrate={() => setScreen("calibrate")} />;
}
 
// ─── Auth Screen ──────────────────────────────────────────────────────────────
 
function AuthScreen({ mode, form, error, onFormChange, onLogin, onSignup, onToggleMode }) {
  const isLogin = mode === "login";
  return (
    <div style={styles.authBg}>
      <div style={styles.authCard}>
        <div style={styles.authLogo}>
          <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
            <circle cx="20" cy="20" r="20" fill="#C9A84C"/>
            <text x="20" y="26" textAnchor="middle" fontSize="18" fill="#1a1a1a" fontFamily="serif">♪</text>
          </svg>
          <span style={styles.authBrand}>ScoreSync</span>
        </div>
        <h2 style={styles.authTitle}>{isLogin ? "Welcome back" : "Create account"}</h2>
        {!isLogin && (
          <input style={styles.authInput} placeholder="Display name"
            value={form.name} onChange={e => onFormChange({...form, name: e.target.value})} />
        )}
        <input style={styles.authInput} placeholder="Email" type="email"
          value={form.email} onChange={e => onFormChange({...form, email: e.target.value})} />
        <input style={styles.authInput} placeholder="Password" type="password"
          value={form.password} onChange={e => onFormChange({...form, password: e.target.value})} />
        {error && <div style={styles.authError}>{error}</div>}
        <button style={styles.authBtn} onClick={isLogin ? onLogin : onSignup}>
          {isLogin ? "Sign In" : "Create Account"}
        </button>
        <button style={styles.authToggle} onClick={onToggleMode}>
          {isLogin ? "Need an account? Sign up" : "Have an account? Sign in"}
        </button>
      </div>
    </div>
  );
}
 
// ─── Instrument Screen ────────────────────────────────────────────────────────
 
function InstrumentScreen({ onSave }) {
  const [selected, setSelected] = useState("Concert (C)");
  const instruments = Object.keys(TRANSPOSITIONS);
  return (
    <div style={styles.authBg}>
      <div style={{...styles.authCard, maxWidth: 520}}>
        <div style={styles.authLogo}>
          <span style={styles.authBrand}>Select Your Instrument</span>
        </div>
        <p style={styles.instrNote}>
          ScoreSync will display all scales in <strong>concert pitch</strong>. 
          For transposing instruments, parts will be transposed automatically on the backend.
        </p>
        <div style={styles.instrGrid}>
          {instruments.map(i => (
            <button key={i} style={{...styles.instrBtn, ...(selected === i ? styles.instrBtnActive : {})}}
              onClick={() => setSelected(i)}>{i}</button>
          ))}
        </div>
        {TRANSPOSITIONS[selected] !== 0 && (
          <div style={styles.transpBadge}>
            ↕ Transposes {Math.abs(TRANSPOSITIONS[selected])} semitone{Math.abs(TRANSPOSITIONS[selected])!==1?"s":""} {TRANSPOSITIONS[selected]>0?"up":"down"} from concert
          </div>
        )}
        <button style={{...styles.authBtn, marginTop: 24}} onClick={() => onSave(selected)}>
          Continue to Calibration →
        </button>
      </div>
    </div>
  );
}
 
// ─── Calibration Screen ─────────────────────────────────────────────────────
 
function CalibrationScreen({ instrument, onDone, onSkip }) {
  const ALL_SCALES = [...MAJOR_SCALES, ...MEYER_SCALES];
  const [step, setStep] = useState(0);
  const [isListening, setIsListening] = useState(false);
  const [detectedNotes, setDetectedNotes] = useState([]);
  const [currentFreq, setCurrentFreq] = useState(0);
  const [calibData, setCalibData] = useState({});
  const [phase, setPhase] = useState("intro"); // intro | playing | done
  const audioCtxRef = useRef(null);
  const analyserRef = useRef(null);
  const sourceRef = useRef(null);
  const rafRef = useRef(null);
  const bufRef = useRef(null);
  const streamRef = useRef(null);
 
  const scale = ALL_SCALES[step];
  const totalSteps = ALL_SCALES.length;
  const transposedScale = {
    ...scale,
    notes: scale.notes.map(n => ((n + TRANSPOSITIONS[instrument]) + 12) % 12)
  };
 
  const startMic = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      audioCtxRef.current = ctx;
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      analyserRef.current = analyser;
      bufRef.current = new Float32Array(analyser.fftSize);
      const src = ctx.createMediaStreamSource(stream);
      src.connect(analyser);
      sourceRef.current = src;
      setIsListening(true);
      setDetectedNotes([]);
    } catch(e) {
      alert("Microphone access denied. Please allow mic access in your browser.");
    }
  }, []);
 
  const stopMic = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
    if (audioCtxRef.current) audioCtxRef.current.close();
    setIsListening(false);
  }, []);
 
  useEffect(() => {
    if (!isListening || !analyserRef.current) return;
    const loop = () => {
      analyserRef.current.getFloatTimeDomainData(bufRef.current);
      const freq = yin(bufRef.current, audioCtxRef.current.sampleRate);
      if (freq > 60 && freq < 2000) {
        setCurrentFreq(freq);
        const midi = freqToMidi(freq);
        const noteName = midiToNoteName(midi);
        setDetectedNotes(prev => {
          const expected = scale.notes.map(n => NOTE_NAMES[n]);
          if (expected.includes(noteName) && (prev.length === 0 || prev[prev.length-1] !== noteName)) {
            return [...prev.slice(-13), noteName];
          }
          return prev;
        });
      }
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, [isListening, scale]);
 
  function handleSaveAndNext() {
    const cd = { ...calibData, [scale.name]: { detectedNotes, instrument } };
    setCalibData(cd);
    stopMic();
    if (step + 1 >= totalSteps) {
      setPhase("done");
      onDone(cd);
    } else {
      setStep(s => s + 1);
      setDetectedNotes([]);
      setCurrentFreq(0);
      setPhase("playing");
    }
  }
 
  const progress = Math.round((step / totalSteps) * 100);
 
  return (
    <div style={styles.authBg}>
      <div style={{...styles.authCard, maxWidth: 580}}>
        {phase === "intro" ? (
          <>
            <div style={styles.authLogo}><span style={styles.authBrand}>Microphone Calibration</span></div>
            <p style={styles.instrNote}>
              You'll play through <strong>12 major scales</strong> and <strong>36 Meyer scale variations</strong> 
              (all in concert pitch). This lets ScoreSync learn your tuning tendencies 
              and playing style for accurate note tracking.
            </p>
            <p style={{color:"#C9A84C", fontSize:13}}>
              All scales displayed in <strong>concert pitch</strong>. 
              {TRANSPOSITIONS[instrument] !== 0 && ` Your ${instrument} part will be transposed automatically.`}
            </p>
            <div style={{display:"flex", gap:12, marginTop:20}}>
              <button style={styles.authBtn} onClick={() => { setPhase("playing"); startMic(); }}>
                Start Calibration
              </button>
              <button style={{...styles.authToggle, border:"1px solid #444", borderRadius:8, padding:"10px 20px"}}
                onClick={onSkip}>Skip for now</button>
            </div>
          </>
        ) : (
          <>
            <div style={styles.calibHeader}>
              <span style={styles.calibScaleName}>{scale.name}</span>
              <span style={styles.calibProgress}>{step+1} / {totalSteps}</span>
            </div>
            <div style={styles.progressBar}><div style={{...styles.progressFill, width:`${progress}%`}}/></div>
            <div style={styles.scaleDisplay}>
              {scale.notes.map((n, i) => {
                const noteName = NOTE_NAMES[n];
                const detected = detectedNotes.includes(noteName);
                return (
                  <div key={i} style={{...styles.scaleNote, ...(detected ? styles.scaleNoteHit : {})}}>
                    {noteName}
                  </div>
                );
              })}
            </div>
 
            <div style={styles.freqDisplay}>
              {currentFreq > 0 ? (
                <>
                  <span style={styles.freqHz}>{currentFreq.toFixed(1)} Hz</span>
                  <span style={styles.freqNote}>{freqToNoteLabel(currentFreq)}</span>
                </>
              ) : (
                <span style={{color:"#666"}}>Play the scale above ascending and descending…</span>
              )}
            </div>
 
            <div style={{display:"flex", gap:12, marginTop:20, justifyContent:"center"}}>
              {!isListening ? (
                <button style={styles.authBtn} onClick={startMic}>🎙 Start Listening</button>
              ) : (
                <>
                  <button style={{...styles.authBtn, background:"#2a5"}} onClick={handleSaveAndNext}>
                    ✓ Save & Next Scale
                  </button>
                  <button style={{...styles.authToggle}} onClick={stopMic}>⏹ Stop Mic</button>
                </>
              )}
              <button style={styles.authToggle} onClick={onSkip}>Skip calibration</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
 
// ─── Main Screen ──────────────────────────────────────────────────────────────
 
function MainScreen({ user, profile, onLogout, onRecalibrate }) {
  const [score, setScore] = useState(null);
  const [scoreType, setScoreType] = useState(null);
  const [markings, setMarkings] = useState([]);
  const [complexMarkings, setComplexMarkings] = useState([]);
  const [restAlerts, setRestAlerts] = useState([]);
  const [rhythmInfo, setRhythmInfo] = useState(null);
  const [isListening, setIsListening] = useState(false);
  const [currentFreq, setCurrentFreq] = useState(0);
  const [currentNote, setCurrentNote] = useState(null);
  const [currentMidi, setCurrentMidi] = useState(null);
  const [cents, setCents] = useState(0);
  const [autoScroll, setAutoScroll] = useState(true);
  const [isAutoScrollPaused, setIsAutoScrollPaused] = useState(false);
  const [sidebarTab, setSidebarTab] = useState("markings");
  const [showProfile, setShowProfile] = useState(false);
  const [tempoPrompt, setTempoPrompt] = useState(false);
  const [currentRestAlert, setCurrentRestAlert] = useState(null);
  const [trainingMode, setTrainingMode] = useState(false);
  const [trainingSegments, setTrainingSegments] = useState([]);
  const [scoreNoteNames, setScoreNoteNames] = useState([]);
  const [loopMode, setLoopMode] = useState("none");
  const [osmdLoaded, setOsmdLoaded] = useState(false);
  const [osmdError, setOsmdError] = useState(null);
  const [markingSuggestions, setMarkingSuggestions] = useState([]);
  const [stickyNotes, setStickyNotes] = useState([]);
  const [currentMeasure, setCurrentMeasure] = useState(1);
  const [voiceRecognitionActive, setVoiceRecognitionActive] = useState(false);
  const [stickyNoteMode, setStickyNoteMode] = useState(false);
  const scoreContainerRef = useRef(null);
  const audioCtxRef = useRef(null);
  const analyserRef = useRef(null);
  const streamRef = useRef(null);
  const rafRef = useRef(null);
  const bufRef = useRef(null);
  const osmdRef = useRef(null);
  const osmdContainerRef = useRef(null);
  const noteHistoryRef = useRef([]);
  const [noteHistory, setNoteHistory] = useState([]);
  const [settings, setSettings] = useState({
    stopAtWrongNote: true,
    loopOnWrongNote: false,
    metronomeSource: "backend", // "backend" or "client"
    metronomeEnabled: false,
    restAlertEnabled: true,
    restAlertAdvance: 1,
    markingSuggestionsEnabled: true,
    stickyNotesEnabled: true,
    voiceMeasureJumpEnabled: true,
  });
  
  const [metronomeState, setMetronomeState] = useState({
    isPlaying: false,
    bpm: 120,
    intervalId: null,
  });
  
  const metronomeActive = metronomeState.isPlaying;
  
  const audioElementRef = useRef(null);
 
  useEffect(() => {
    const script = document.createElement("script");
    script.src = "https://cdnjs.cloudflare.com/ajax/libs/opensheetmusicdisplay/1.8.6/opensheetmusicdisplay.min.js";
    script.onload = () => setOsmdLoaded(true);
    script.onerror = () => setOsmdError("Could not load score renderer.");
    document.head.appendChild(script);
    return () => document.head.removeChild(script);
  }, []);
 
  useEffect(() => {
    if (!osmdLoaded || !score || scoreType !== "musicxml") return;
    const container = osmdContainerRef.current;
    if (!container) return;
    try {
      const OSMD = window.opensheetmusicdisplay?.OpenSheetMusicDisplay;
      if (!OSMD) return;
      const osmd = new OSMD(container, { autoResize: true, drawTitle: true });
      osmdRef.current = osmd;
      osmd.load(score).then(() => {
        osmd.render();
      }).catch(e => setOsmdError("Could not render score: " + e.message));
    } catch(e) {
      setOsmdError("Score render error: " + e.message);
    }
  }, [osmdLoaded, score, scoreType]);
 
  async function handleFileLoad(e) {
    const file = e.target.files[0];
    if (!file) return;
    setOsmdError(null);
    const ext = file.name.split(".").pop().toLowerCase();
    if (ext === "pdf") {
      const url = URL.createObjectURL(file);
      setScore(url);
      setScoreType("pdf");
      setMarkings([]);
    } else if (ext === "xml" || ext === "mxl" || ext === "musicxml") {
      const text = await file.text();
      setScore(text);
      setScoreType("musicxml");
      
      // Analyze markings locally
      const baseMarkings = analyzeMarkings(text);
      setMarkings(baseMarkings);
      
      // Extract rhythm info and complex markings
      const rhythmMatch = text.match(/<time>\s*<beats>(\d+)<\/beats>\s*<beat-type>(\d+)<\/beat-type>/);
      const timeSignature = rhythmMatch ? `${rhythmMatch[1]}/${rhythmMatch[2]}` : "4/4";
      
      const tempoMatch = text.match(/<metronome>[\s\S]*?<per-minute>(\d+)<\/per-minute>/);
      const tempo = tempoMatch ? parseInt(tempoMatch[1]) : 120;
      
      const noteCount = (text.match(/<note\b/g) || []).length;
      const restCount = (text.match(/<rest\b/g) || []).length;
      
      setRhythmInfo({
        time_signature: timeSignature,
        tempo_bpm: tempo,
        note_count: noteCount,
        rest_count: restCount,
      });
      
      setMetronomeState(prev => ({ ...prev, bpm: tempo }));
      setCurrentRestAlert(null);
      setTrainingSegments([]);
      setScoreNoteNames(extractScoreNoteNames(text));
      setRestAlerts(extractRestAlerts(text));
      
      // Extract complex markings
      const markingsList = [];
      const measures = text.match(/<measure[^>]*number="([^"]*)"[^>]*>([\s\S]*?)<\/measure>/g) || [];
      measures.forEach(measure => {
        const measureMatch = measure.match(/number="([^"]*)"/);
        const measureNum = measureMatch ? parseInt(measureMatch[1]) : 0;
        if (measure.includes("<accent") || measure.includes("<staccato") || measure.includes("<tenuto")) {
          markingsList.push({ measure: measureNum, type: "articulation", value: "accent/staccato" });
        }
        if (measure.includes("<rest")) {
          markingsList.push({ measure: measureNum, type: "rest", value: "rest" });
        }
        if (measure.includes("<fermata")) {
          markingsList.push({ measure: measureNum, type: "fermata", value: "fermata" });
        }
      });
      setComplexMarkings(markingsList);
    } else if (ext === "mscz" || ext === "mscx") {
      setScore(null);
      setScoreType("musescore");
      setMarkings([]);
    } else {
      alert("Supported: .pdf, .xml, .musicxml, .mxl (MuseScore requires server conversion)");
    }
    e.target.value = "";
  }
  
  const startMetronome = useCallback(async () => {
    if (!rhythmInfo) return;

    try {
      const response = await fetch(
        `/playback/metronome?bpm=${metronomeState.bpm}&time_signature=${rhythmInfo.time_signature}&duration_seconds=8`,
        { method: "POST" }
      );
      if (response.ok) {
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        if (audioElementRef.current) {
          audioElementRef.current.src = url;
          await audioElementRef.current.play();
          setMetronomeState(prev => ({ ...prev, isPlaying: true }));
        }
      }
    } catch (e) {
      console.error("Metronome error:", e);
    }
  }, [metronomeState.bpm, rhythmInfo]);
  
  const stopMetronome = useCallback(() => {
    if (audioElementRef.current) {
      audioElementRef.current.pause();
      audioElementRef.current.currentTime = 0;
    }
    setMetronomeState(prev => ({ ...prev, isPlaying: false }));
  }, []);
  
  const handleStickyNoteClick = useCallback((event) => {
    if (!stickyNoteMode || !scoreContainerRef.current) return;
    
    const rect = scoreContainerRef.current.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top + scoreContainerRef.current.scrollTop;
    
    const newNote = {
      id: Date.now(),
      x: x,
      y: y,
      measure: currentMeasure,
      text: '',
      color: '#FFFF88'
    };
    
    setStickyNotes(prev => [...prev, newNote]);
  }, [stickyNoteMode, currentMeasure]);

  const updateStickyNote = useCallback((id, updates) => {
    setStickyNotes(prev => prev.map(note => 
      note.id === id ? { ...note, ...updates } : note
    ));
  }, []);

  const deleteStickyNote = useCallback((id) => {
    setStickyNotes(prev => prev.filter(note => note.id !== id));
  }, []);

  useEffect(() => {
    if (settings.metronomeEnabled && rhythmInfo) {
      startMetronome();
      return () => stopMetronome();
    }
    stopMetronome();
  }, [settings.metronomeEnabled, rhythmInfo, startMetronome, stopMetronome]);

  // Voice recognition for measure jumping
  useEffect(() => {
    let recognition = null;
    
    if (settings.voiceMeasureJumpEnabled && isListening) {
      recognition = startVoiceRecognition((measureNumber) => {
        // Jump to measure and advance by 4 counts
        const targetMeasure = Math.max(1, measureNumber + 4);
        setCurrentMeasure(targetMeasure);
        setIsAutoScrollPaused(false);
        
        // Scroll to approximate position
        if (scoreContainerRef.current) {
          const scrollAmount = (targetMeasure - 1) * 100; // Rough estimate
          scoreContainerRef.current.scrollTop = scrollAmount;
        }
      });
      setVoiceRecognitionActive(true);
    } else {
      if (recognition) {
        recognition.stop();
      }
      setVoiceRecognitionActive(false);
    }
    
    return () => {
      if (recognition) {
        recognition.stop();
      }
    };
  }, [settings.voiceMeasureJumpEnabled, isListening]);

  // Update metronome BPM when rhythm info changes
  useEffect(() => {
    if (rhythmInfo?.tempo_bpm) {
      setMetronomeState(prev => ({ ...prev, bpm: rhythmInfo.tempo_bpm }));
    }
  }, [rhythmInfo]);

  // Generate marking suggestions based on current measure
  useEffect(() => {
    if (settings.markingSuggestionsEnabled && rhythmInfo && complexMarkings.length > 0) {
      const suggestions = generateMarkingSuggestions(currentMeasure, rhythmInfo, complexMarkings);
      setMarkingSuggestions(suggestions);
    } else {
      setMarkingSuggestions([]);
    }
  }, [currentMeasure, settings.markingSuggestionsEnabled, rhythmInfo, complexMarkings]);
 
  const startMic = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      audioCtxRef.current = ctx;
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 4096;
      analyserRef.current = analyser;
      bufRef.current = new Float32Array(analyser.fftSize);
      ctx.createMediaStreamSource(stream).connect(analyser);
      setIsListening(true);
    } catch { alert("Microphone access required."); }
  }, []);
 
  const stopMic = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
    if (audioCtxRef.current) audioCtxRef.current.close();
    setIsListening(false);
    setCurrentFreq(0); setCurrentNote(null); setCurrentMidi(null); setCents(0);
  }, []);
  
  // Monitor for wrong notes and rest alerts
  useEffect(() => {
    if (!isListening || !currentNote) return;

    if (settings.stopAtWrongNote && scoreNoteNames.length > 0) {
      const bareNote = currentNote.replace(/\d+$/, "");
      if (!scoreNoteNames.includes(bareNote)) {
        setIsAutoScrollPaused(true);
        if (settings.loopOnWrongNote) {
          setLoopMode("measure");
        }
      }
    }
  }, [isListening, currentNote, settings.stopAtWrongNote, settings.loopOnWrongNote, scoreNoteNames]);
 
  useEffect(() => {
    if (!isListening || !analyserRef.current) return;
    const loop = () => {
      analyserRef.current.getFloatTimeDomainData(bufRef.current);
      const freq = yin(bufRef.current, audioCtxRef.current.sampleRate);
      if (freq > 40 && freq < 4200) {
        setCurrentFreq(freq);
        const midi = freqToMidi(freq);
        setCurrentMidi(midi);
        setCurrentNote(freqToNoteLabel(freq));
        setCents(centsDiff(freq, midi));
        const entry = { freq, note: freqToNoteLabel(freq), time: Date.now() };
        noteHistoryRef.current = [...noteHistoryRef.current.slice(-49), entry];
        setNoteHistory([...noteHistoryRef.current]);

        if (settings.restAlertEnabled && restAlerts.length > 0 && rhythmInfo) {
          const currentMeasureEstimate = Math.max(1, Math.ceil(noteHistoryRef.current.length * (rhythmInfo.tempo_bpm || 120) / 60));
          setCurrentMeasure(currentMeasureEstimate);
          const upcomingRestMeasure = restAlerts.find(r => r.measure > currentMeasureEstimate && r.measure <= currentMeasureEstimate + settings.restAlertAdvance);
          if (upcomingRestMeasure) {
            setCurrentRestAlert({
              measure: upcomingRestMeasure.measure,
              beatsUntil: Math.max(0, upcomingRestMeasure.measure - currentMeasureEstimate),
              isCritical: upcomingRestMeasure.measure - currentMeasureEstimate <= 1,
            });
          } else {
            setCurrentRestAlert(null);
          }
        }
      } else {
        setCurrentFreq(0); setCurrentNote(null); setCents(0);
      }
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, [isListening, settings, restAlerts, rhythmInfo]);
 
  useEffect(() => {
    if (!autoScroll || !isListening || !scoreContainerRef.current) return;
    const id = setInterval(() => {
      if (isAutoScrollPaused) {
        return; // Don't scroll if paused
      }
      if (currentFreq > 0) {
        scoreContainerRef.current.scrollTop += 0.4;
      } else if (settings.pauseOnSilence) {
        setIsAutoScrollPaused(true); // Pause on silence
      }
    }, 50);
    return () => clearInterval(id);
  }, [autoScroll, isListening, currentFreq, isAutoScrollPaused, settings.pauseOnSilence]);
 
  const tunerColor = Math.abs(cents) < 10 ? "#2aee6e" : Math.abs(cents) < 25 ? "#f5c542" : "#ee4444";
  const tunerOffset = Math.max(-50, Math.min(50, cents));
 
  return (
    <div style={styles.mainBg}>
      <div style={styles.topBar}>
        <div style={styles.topBrand}>
          <svg width="28" height="28" viewBox="0 0 40 40" fill="none">
            <circle cx="20" cy="20" r="20" fill="#C9A84C"/>
            <text x="20" y="27" textAnchor="middle" fontSize="20" fill="#1a1a1a" fontFamily="serif">♪</text>
          </svg>
          <span style={styles.topBrandName}>ScoreSync</span>
        </div>
        <div style={styles.topControls}>
          <label style={styles.uploadBtn}>
            📂 Load Score
            <input type="file" accept=".pdf,.xml,.musicxml,.mxl,.mscz,.mscx" style={{display:"none"}} onChange={handleFileLoad}/>
          </label>
          <button style={{...styles.micBtn, ...(isListening ? styles.micBtnActive : {})}}
            onClick={isListening ? stopMic : startMic}>
            {isListening ? "🔴 Stop Mic" : "🎙 Start Mic"}
          </button>
          <label style={styles.topToggle}>
            <input type="checkbox" checked={autoScroll} onChange={e => setAutoScroll(e.target.checked)} style={{marginRight:6}}/>
            Auto-scroll
          </label>
          {isAutoScrollPaused && (
            <button style={{...styles.micBtn, background:"#2a5", border:"1px solid #4a9"}} onClick={() => setIsAutoScrollPaused(false)}>
              ▶ Resume
            </button>
          )}
          {loopMode !== "none" && (
            <span style={{fontSize:11, color:"#C9A84C", padding:"4px 8px", background:"#2a2010", borderRadius:4}}>
              🔄 {loopMode === "measure" ? "Measure Loop" : "Phrase Loop"}
            </span>
          )}
          <button style={{...styles.micBtn, ...(stickyNoteMode ? {background:"#C9A84C", color:"#1a1200"} : {})}}
            onClick={() => setStickyNoteMode(!stickyNoteMode)}>
            📌 {stickyNoteMode ? "Exit Notes" : "Sticky Notes"}
          </button>
          {voiceRecognitionActive && (
            <span style={{fontSize:11, color:"#2aee6e", padding:"4px 8px", background:"#1a2a1a", borderRadius:4}}>
              🎤 Voice Active
            </span>
          )}
          <div style={styles.userBadge} onClick={() => setShowProfile(p => !p)}>
            <div style={styles.avatar}>{user.name[0].toUpperCase()}</div>
            <span style={styles.userName}>{user.name}</span>
          </div>
        </div>
      </div>
 
      {showProfile && (
        <div style={styles.profileDrop}>
          <div style={styles.profileItem}><strong>{user.name}</strong></div>
          <div style={styles.profileItem}>{user.email}</div>
          <div style={styles.profileItem}>🎺 {profile.instrument}</div>
          <button style={styles.profileBtn} onClick={onRecalibrate}>Recalibrate</button>
          <button style={{...styles.profileBtn, color:"#ee4444"}} onClick={onLogout}>Sign Out</button>
        </div>
      )}
      
      {/* Rest Alert Notification */}
      {currentRestAlert && settings.restAlertEnabled && (
        <div style={{...styles.alertBanner}}>
          ⏰ Rest Alert: Measure {currentRestAlert.measure} in {currentRestAlert.beatsUntil.toFixed(1)} beat(s)
        </div>
      )}
      
      {/* Tempo Prompter */}
      {tempoPrompt && rhythmInfo && (
        <div style={styles.tempoPrompter}>
          <div style={styles.tempoTitle}>Tempo: {metronomeState.bpm} BPM</div>
          <div style={styles.tempoSubtitle}>{rhythmInfo.time_signature}</div>
          <div style={{display:"flex", gap:8, marginTop:12, justifyContent:"center"}}>
            <button style={styles.tempoBtn} onClick={startMetronome}>
              {metronomeState.isPlaying ? "🔴 Stop" : "▶ Play Metronome"}
            </button>
            <button style={{...styles.tempoBtn, background:"#1e1a14"}} onClick={() => setTempoPrompt(false)}>
              ✓ Ready
            </button>
          </div>
        </div>
      )}
 
      <div style={styles.mainBody}>
        <div style={styles.scorePanel} ref={scoreContainerRef}>
          {/* Rest Alert Banner */}
          {settings.restAlertEnabled && currentRestAlert && (
            <div style={{...styles.restAlertBanner, background: currentRestAlert.isCritical ? "#8b2e2e" : "#3a3824"}}>
              <div style={{fontSize:14, fontWeight:700, color: currentRestAlert.isCritical ? "#ff6b6b" : "#C9A84C"}}>
                ⚠ REST ALERT - Measure {currentRestAlert.measure}
              </div>
              <div style={{fontSize:12, color: currentRestAlert.isCritical ? "#ffb3b3" : "#d4af9f", marginTop:4}}>
                {currentRestAlert.isCritical ? "REST ENDS IN 1 BEAT" : `Rest in ${currentRestAlert.beatsUntil.toFixed(1)} beats`}
              </div>
            </div>
          )}

          {/* Marking Suggestions */}
          {settings.markingSuggestionsEnabled && markingSuggestions.length > 0 && (
            <div style={styles.markingSuggestionsBanner}>
              <div style={{fontSize:14, fontWeight:700, color:"#C9A84C", marginBottom:4}}>
                💡 Performance Enhancement Suggestions
              </div>
              {markingSuggestions.slice(0,2).map((suggestion, i) => (
                <div key={i} style={{fontSize:12, color:"#d4af9f", marginBottom:2}}>
                  • {suggestion.suggestion}
                </div>
              ))}
            </div>
          )}

          {/* Sticky Notes Overlay */}
          {settings.stickyNotesEnabled && stickyNotes.length > 0 && (
            <div style={styles.stickyNotesOverlay}>
              {stickyNotes.map(note => (
                <div
                  key={note.id}
                  style={{
                    ...styles.stickyNote,
                    left: note.x,
                    top: note.y,
                    backgroundColor: note.color
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    const newText = prompt('Edit sticky note:', note.text) || note.text;
                    updateStickyNote(note.id, { text: newText });
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    if (confirm('Delete this sticky note?')) {
                      deleteStickyNote(note.id);
                    }
                  }}
                >
                  <div style={styles.stickyNoteText}>{note.text || 'Click to edit'}</div>
                  <div style={styles.stickyNoteMeasure}>M{note.measure}</div>
                </div>
              ))}
            </div>
          )}

          {/* Sticky Note Mode Click Handler */}
          {stickyNoteMode && (
            <div
              style={styles.stickyNoteModeOverlay}
              onClick={handleStickyNoteClick}
            >
              <div style={styles.stickyNoteModeHint}>
                📌 Click anywhere on the score to add a sticky note
              </div>
            </div>
          )}
          {!score ? (
            <div style={styles.scorePlaceholder}>
              <div style={styles.placeholderIcon}>𝄞</div>
              <div style={styles.placeholderText}>Load a score to begin</div>
              <div style={styles.placeholderSub}>Supports PDF, MusicXML (.xml, .mxl, .musicxml)<br/>MuseScore files require server-side conversion</div>
            </div>
          ) : scoreType === "pdf" ? (
            <iframe src={score} style={styles.pdfFrame} title="Score PDF"/>
          ) : scoreType === "musicxml" ? (
            <>
              {osmdError && <div style={styles.osmdError}>{osmdError}</div>}
              <div ref={osmdContainerRef} style={styles.osmdContainer}/>
            </>
          ) : (
            <div style={styles.scorePlaceholder}>
              <div style={styles.placeholderIcon}>⚙️</div>
              <div style={styles.placeholderText}>MuseScore file detected</div>
              <div style={styles.placeholderSub}>MuseScore (.mscz) files require server-side<br/>conversion via MuseScore CLI. Connect a backend<br/>to enable this.</div>
            </div>
          )}
        </div>
 
        <div style={styles.rightPanel}>
          <div style={styles.pitchCard}>
            <div style={styles.pitchTitle}>Live Pitch</div>
            {currentNote ? (
              <>
                <div style={styles.bigNote}>{currentNote}</div>
                <div style={styles.freqLine}>{currentFreq.toFixed(2)} Hz</div>
                <div style={styles.tunerTrack}>
                  <div style={{...styles.tunerNeedle, left:`calc(50% + ${tunerOffset}%)`, background: tunerColor}}/>
                  <div style={styles.tunerCenter}/>
                </div>
                <div style={{...styles.centsLabel, color: tunerColor}}>
                  {cents > 0 ? "+" : ""}{cents.toFixed(1)}¢
                </div>
              </>
            ) : (
              <div style={styles.pitchIdle}>
                {isListening ? "Listening…" : "Start mic to detect pitch"}
              </div>
            )}
          </div>
 
          <div style={styles.historyCard}>
            <div style={styles.pitchTitle}>Recent Notes</div>
            <div style={styles.historyScroll}>
              {noteHistory.length === 0 && <span style={{color:"#555", fontSize:12}}>Notes will appear here</span>}
              {[...noteHistory].reverse().slice(0,20).map((n,i) => (
                <span key={i} style={{...styles.historyNote, opacity: 1 - i*0.045}}>{n.note}</span>
              ))}
            </div>
          </div>
 
          <div style={styles.sidebarTabs}>
            {["markings","info","training","metronome","settings"].map(t => (
              <button key={t} style={{...styles.sidebarTab, ...(sidebarTab===t ? styles.sidebarTabActive:{})}}
                onClick={() => setSidebarTab(t)}>{t.charAt(0).toUpperCase()+t.slice(1)}</button>
            ))}
          </div>
 
          {sidebarTab === "markings" && (
            <div style={styles.markingsCard}>
              {markings.length === 0 ? (
                <div style={{color:"#555", fontSize:12, padding:8}}>
                  Load a MusicXML file to analyze stylistic markings
                </div>
              ) : markings.map((m,i) => (
                <div key={i} style={styles.markingItem}>
                  <span style={styles.markingType}>{m.type}</span>
                  <span style={styles.markingCount}>×{m.count}</span>
                  <span style={styles.markingDetail}>{m.detail}</span>
                </div>
              ))}
            </div>
          )}
 
          {sidebarTab === "info" && (
            <div style={styles.markingsCard}>
              <div style={styles.infoRow}>
                <span style={styles.infoLabel}>Instrument</span>
                <span style={styles.infoVal}>{profile.instrument}</span>
              </div>
              <div style={styles.infoRow}>
                <span style={styles.infoLabel}>Transposition</span>
                <span style={styles.infoVal}>
                  {TRANSPOSITIONS[profile.instrument] === 0 ? "None (concert)" :
                    `${Math.abs(TRANSPOSITIONS[profile.instrument])} st ${TRANSPOSITIONS[profile.instrument]>0?"up":"down"}`}
                </span>
              </div>
              <div style={styles.infoRow}>
                <span style={styles.infoLabel}>Calibration</span>
                <span style={styles.infoVal}>
                  {profile.calibration?.skipped ? "Skipped" :
                    profile.calibration ? `${Object.keys(profile.calibration).length} scales` : "None"}
                </span>
              </div>
              <button style={{...styles.profileBtn, marginTop:12, width:"100%"}} onClick={onRecalibrate}>
                Recalibrate
              </button>
            </div>
          )}
 
          {sidebarTab === "training" && (
            <div style={styles.markingsCard}>
              <div style={{fontSize:12, color:"#a89060", marginBottom:8}}>
                <strong>Training Mode</strong> - Practice with synthesized playback and segment control
              </div>
              {!score ? (
                <div style={{fontSize:11, color:"#665040", padding:8, background:"#1a1610", borderRadius:4}}>
                  Load a score to enable training mode.
                </div>
              ) : (
                <>
                  <div style={styles.settingRow}>
                    <label style={{display:"flex", alignItems:"center", gap:6, cursor:"pointer"}}>
                      <input type="checkbox" checked={trainingMode} onChange={e => setTrainingMode(e.target.checked)} style={{marginRight:0}}/>
                      <span style={{fontSize:12, color:"#a89060"}}>Enable training mode</span>
                    </label>
                  </div>
                  {trainingMode && rhythmInfo && (
                    <>
                      <div style={{fontSize:11, color:"#665040", marginTop:8, padding:8, background:"#1a1610", borderRadius:4}}>
                        ♪ Tempo: {rhythmInfo.tempo_bpm} BPM | Time: {rhythmInfo.time_signature}<br/>
                        Notes: {rhythmInfo.note_count} | Rests: {rhythmInfo.rest_count}<br/>
                        Current Measure: {currentMeasure}
                      </div>
                      
                      <div style={{marginTop:12, marginBottom:8}}>
                        <div style={{fontSize:11, color:"#a89060", marginBottom:6}}>Playback Controls</div>
                        <div style={{display:"flex", gap:6, marginBottom:8}}>
                          <button style={{...styles.profileBtn, flex:1, fontSize:11}} 
                            onClick={async () => {
                              if (!score || scoreType !== "musicxml") return;
                              const form = new FormData();
                              form.append("file", new Blob([score], { type: "application/xml" }), "score.xml");
                              if (rhythmInfo?.tempo_bpm) {
                                form.append("tempo_override", String(rhythmInfo.tempo_bpm));
                              }
                              try {
                                const response = await fetch("/scores/training/synthesize", { method: "POST", body: form });
                                if (response.ok) {
                                  const blob = await response.blob();
                                  const url = URL.createObjectURL(blob);
                                  if (audioElementRef.current) {
                                    audioElementRef.current.src = url;
                                    await audioElementRef.current.play();
                                  }
                                } else {
                                  console.error("Training synth failed", await response.text());
                                }
                              } catch (err) {
                                console.error(err);
                              }
                            }}>
                            🎵 Synth Track
                          </button>
                          <button style={{...styles.profileBtn, flex:1, fontSize:11, background:"#2a5"}} 
                            onClick={() => {
                              if (audioElementRef.current) {
                                audioElementRef.current.pause();
                                audioElementRef.current.currentTime = 0;
                              }
                            }}>
                            ⏹ Stop
                          </button>
                        </div>
                      </div>
                      
                      <button style={{...styles.profileBtn, marginTop:6, width:"100%", background:"#1e1a14"}} 
                        onClick={async () => {
                          if (!score || scoreType !== "musicxml") return;
                          const form = new FormData();
                          form.append("file", new Blob([score], { type: "application/xml" }), "score.xml");
                          form.append("segment_size", "4");
                          try {
                            const response = await fetch("/scores/training/segments", { method: "POST", body: form });
                            if (response.ok) {
                              const payload = await response.json();
                              setTrainingSegments(payload.segments || []);
                            } else {
                              console.error("Segment extraction failed", await response.text());
                            }
                          } catch (err) {
                            console.error(err);
                          }
                        }}>
                        📊 Extract Segments
                      </button>
                      
                      {trainingSegments.length > 0 && (
                        <div style={{marginTop:12, borderTop:"1px solid #2a2010", paddingTop:10}}>
                          <div style={{fontSize:11, color:"#a89060", marginBottom:6}}>Practice Segments ({trainingSegments.length})</div>
                          <div style={{maxHeight:200, overflow:"auto"}}>
                            {trainingSegments.map(segment => (
                              <div key={segment.segment_id} style={{fontSize:12, color:"#d8cfa3", marginBottom:6, padding:8, background:"#1a1610", borderRadius:6, cursor:"pointer"}}
                                onClick={() => {
                                  // Jump to segment start
                                  setCurrentMeasure(segment.start_measure);
                                  if (scoreContainerRef.current) {
                                    const scrollAmount = (segment.start_measure - 1) * 120; // Rough estimate
                                    scoreContainerRef.current.scrollTop = scrollAmount;
                                  }
                                }}>
                                <div style={{fontWeight:700}}>Segment {segment.segment_id}: M{segment.start_measure}–{segment.end_measure}</div>
                                <div style={{fontSize:11, color:"#8e7b55", marginTop:2}}>
                                  {segment.measure_count} measures • rests: {segment.markings.hasRests ? "yes" : "no"}, accents: {segment.markings.hasAccents ? "yes" : "no"}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      
                      <div style={{marginTop:12, padding:8, background:"#1a1610", borderRadius:4}}>
                        <div style={{fontSize:11, color:"#a89060", marginBottom:4}}>Practice Statistics</div>
                        <div style={{fontSize:10, color:"#665040"}}>
                          Current: Measure {currentMeasure}<br/>
                          Segments: {trainingSegments.length}<br/>
                          Sticky Notes: {stickyNotes.length}
                        </div>
                      </div>
                    </>
                  )}
                </>
              )}
            </div>
          )}

          {sidebarTab === "metronome" && (
            <div style={styles.markingsCard}>
              <div style={{fontSize:12, color:"#a89060", marginBottom:8}}>
                <strong>Metronome</strong> - Practice timing and rhythm
              </div>
              {!rhythmInfo ? (
                <div style={{fontSize:11, color:"#665040", padding:8, background:"#1a1610", borderRadius:4}}>
                  Load a score to enable metronome features.
                </div>
              ) : (
                <>
                  <div style={{fontSize:11, color:"#665040", marginTop:8, padding:8, background:"#1a1610", borderRadius:4}}>
                    ♪ Tempo: {rhythmInfo.tempo_bpm} BPM | Time: {rhythmInfo.time_signature}
                  </div>
                  
                  <div style={styles.settingRow}>
                    <label style={{display:"flex", alignItems:"center", gap:6, cursor:"pointer"}}>
                      <input type="checkbox" checked={settings.metronomeEnabled} onChange={e => setSettings({...settings, metronomeEnabled: e.target.checked})} style={{marginRight:0}}/>
                      <span style={{fontSize:12, color:"#a89060"}}>Enable metronome</span>
                    </label>
                  </div>
                  
                  {settings.metronomeEnabled && (
                    <>
                      <div style={{marginTop:12, marginBottom:8}}>
                        <div style={{fontSize:11, color:"#a89060", marginBottom:6}}>Metronome Controls</div>
                        <div style={{display:"flex", gap:6, marginBottom:8}}>
                          <button style={{...styles.profileBtn, flex:1, fontSize:11, background:"#2a5"}} 
                            onClick={startMetronome}>
                            ▶️ Start
                          </button>
                          <button style={{...styles.profileBtn, flex:1, fontSize:11, background:"#a52"}} 
                            onClick={stopMetronome}>
                            ⏹ Stop
                          </button>
                        </div>
                      </div>
                      
                      <button style={{...styles.profileBtn, marginTop:6, width:"100%", background:"#1e1a14"}} 
                        onClick={async () => {
                          try {
                            const response = await fetch("/playback/metronome", {
                              method: "POST",
                              headers: { "Content-Type": "application/x-www-form-urlencoded" },
                              body: new URLSearchParams({
                                bpm: String(rhythmInfo.tempo_bpm),
                                time_signature: rhythmInfo.time_signature,
                                duration_seconds: "30",
                                accent_first: "true"
                              })
                            });
                            if (response.ok) {
                              const blob = await response.blob();
                              const url = URL.createObjectURL(blob);
                              if (audioElementRef.current) {
                                audioElementRef.current.src = url;
                                await audioElementRef.current.play();
                              }
                            } else {
                              console.error("Metronome generation failed", await response.text());
                            }
                          } catch (err) {
                            console.error(err);
                          }
                        }}>
                        🎵 Generate Metronome Track
                      </button>
                      
                      <div style={{marginTop:12, padding:8, background:"#1a1610", borderRadius:4}}>
                        <div style={{fontSize:11, color:"#a89060", marginBottom:4}}>Metronome Settings</div>
                        <div style={{fontSize:10, color:"#665040"}}>
                          BPM: {rhythmInfo.tempo_bpm}<br/>
                          Time Signature: {rhythmInfo.time_signature}<br/>
                          Status: {metronomeActive ? "Active" : "Inactive"}
                        </div>
                      </div>
                    </>
                  )}
                </>
              )}
            </div>
          )}

          {sidebarTab === "settings" && (
            <div style={styles.markingsCard}>
              <div style={styles.settingRow}>
                <label style={{display:"flex", alignItems:"center", gap:6, cursor:"pointer"}}>
                  <input type="checkbox" checked={settings.stopAtWrongNote} onChange={e => setSettings({...settings, stopAtWrongNote: e.target.checked})} style={{marginRight:0}}/>
                  <span style={{fontSize:12, color:"#a89060"}}>Stop on wrong note</span>
                </label>
              </div>
              <div style={styles.settingRow}>
                <label style={{display:"flex", alignItems:"center", gap:6, cursor:"pointer"}}>
                  <input type="checkbox" checked={settings.loopOnWrongNote} onChange={e => setSettings({...settings, loopOnWrongNote: e.target.checked})} style={{marginRight:0}}/>
                  <span style={{fontSize:12, color:"#a89060"}}>Loop on wrong note</span>
                </label>
              </div>
              <div style={styles.settingRow}>
                <label style={{display:"flex", alignItems:"center", gap:6, cursor:"pointer"}}>
                  <input type="checkbox" checked={settings.metronomeEnabled} onChange={e => setSettings({...settings, metronomeEnabled: e.target.checked})} style={{marginRight:0}}/>
                  <span style={{fontSize:12, color:"#a89060"}}>Enable metronome</span>
                </label>
              </div>
              {settings.metronomeEnabled && (
                <div style={styles.settingRow}>
                  <select value={settings.metronomeSource} onChange={e => setSettings({...settings, metronomeSource: e.target.value})} style={{fontSize:12, width:"100%", padding:"4px", background:"#1e1a14", border:"1px solid #3a2e1e", color:"#a89060", borderRadius:4}}>
                    <option value="backend">Backend Metronome</option>
                    <option value="client">Client Metronome</option>
                  </select>
                </div>
              )}
              <div style={styles.settingRow}>
                <label style={{display:"flex", alignItems:"center", gap:6, cursor:"pointer"}}>
                  <input type="checkbox" checked={settings.restAlertEnabled} onChange={e => setSettings({...settings, restAlertEnabled: e.target.checked})} style={{marginRight:0}}/>
                  <span style={{fontSize:12, color:"#a89060"}}>Rest alerts</span>
                </label>
              </div>
              {settings.restAlertEnabled && (
                <div style={{...styles.settingRow, marginTop:4}}>
                  <span style={{fontSize:11, color:"#665040"}}>Alert {settings.restAlertAdvance} beat(s) before</span>
                  <input type="number" min="1" max="8" value={settings.restAlertAdvance} onChange={e => setSettings({...settings, restAlertAdvance: parseInt(e.target.value)})} style={{width:"40px", padding:"3px", marginLeft:"auto", background:"#1e1a14", border:"1px solid #3a2e1e", color:"#a89060", borderRadius:4}}/>
                </div>
              )}
              <div style={styles.settingRow}>
                <label style={{display:"flex", alignItems:"center", gap:6, cursor:"pointer"}}>
                  <input type="checkbox" checked={settings.markingSuggestionsEnabled} onChange={e => setSettings({...settings, markingSuggestionsEnabled: e.target.checked})} style={{marginRight:0}}/>
                  <span style={{fontSize:12, color:"#a89060"}}>Marking suggestions</span>
                </label>
              </div>
              <div style={styles.settingRow}>
                <label style={{display:"flex", alignItems:"center", gap:6, cursor:"pointer"}}>
                  <input type="checkbox" checked={settings.stickyNotesEnabled} onChange={e => setSettings({...settings, stickyNotesEnabled: e.target.checked})} style={{marginRight:0}}/>
                  <span style={{fontSize:12, color:"#a89060"}}>Sticky notes</span>
                </label>
              </div>
              <div style={styles.settingRow}>
                <label style={{display:"flex", alignItems:"center", gap:6, cursor:"pointer"}}>
                  <input type="checkbox" checked={settings.voiceMeasureJumpEnabled} onChange={e => setSettings({...settings, voiceMeasureJumpEnabled: e.target.checked})} style={{marginRight:0}}/>
                  <span style={{fontSize:12, color:"#a89060"}}>Voice measure jumping</span>
                </label>
              </div>
              {rhythmInfo && (
                <button style={{...styles.profileBtn, marginTop:12, width:"100%", background:"#C9A84C22", color:"#C9A84C", border:"1px solid #C9A84C"}} onClick={() => setTempoPrompt(true)}>
                  ♩ Start Tempo Prompt
                </button>
              )}
            </div>
          )}
        </div>
      </div>
      
      {/* Hidden audio element for metronome */}
      <audio ref={audioElementRef} style={{display:"none"}}/>
    </div>
  );
}
 
// ─── Styles ───────────────────────────────────────────────────────────────────
 
const styles = {
  authBg: {
    minHeight:"100vh", background:"#111", display:"flex", alignItems:"center",
    justifyContent:"center", fontFamily:"'Georgia', serif",
    backgroundImage:"radial-gradient(ellipse at 30% 60%, #1e1608 0%, #111 60%)",
  },
  authCard: {
    background:"#181410", border:"1px solid #2e2416", borderRadius:16,
    padding:"40px 36px", width:"100%", maxWidth:420, display:"flex",
    flexDirection:"column", gap:14, boxShadow:"0 24px 80px rgba(0,0,0,0.6)",
  },
  authLogo: { display:"flex", alignItems:"center", gap:12, marginBottom:4 },
  authBrand: { fontSize:22, fontWeight:700, color:"#C9A84C", letterSpacing:"0.04em" },
  authTitle: { fontSize:18, color:"#e8d9b0", margin:0, fontWeight:400 },
  authInput: {
    background:"#1e1a14", border:"1px solid #3a2e1e", borderRadius:8, padding:"10px 14px",
    color:"#e8d9b0", fontSize:14, fontFamily:"inherit", outline:"none",
  },
  authBtn: {
    background:"#C9A84C", color:"#1a1200", border:"none", borderRadius:8,
    padding:"12px 0", fontSize:15, fontWeight:700, cursor:"pointer", letterSpacing:"0.03em",
  },
  authToggle: {
    background:"none", border:"none", color:"#876a2a", fontSize:13, cursor:"pointer", padding:4,
  },
  authError: { color:"#ee5555", fontSize:13, padding:"4px 8px", background:"#2a1111", borderRadius:6 },
  instrNote: { color:"#a89060", fontSize:13, lineHeight:1.6, margin:0 },
  instrGrid: { display:"flex", flexWrap:"wrap", gap:8, marginTop:8 },
  instrBtn: {
    background:"#1e1a14", border:"1px solid #3a2e1e", borderRadius:8, padding:"7px 12px",
    color:"#a89060", fontSize:12, cursor:"pointer",
  },
  instrBtnActive: { background:"#C9A84C22", border:"1px solid #C9A84C", color:"#C9A84C" },
  transpBadge: {
    background:"#1e2a1e", border:"1px solid #2a4a2a", borderRadius:8, padding:"8px 12px",
    color:"#6aaa6a", fontSize:12,
  },
  calibHeader: { display:"flex", justifyContent:"space-between", alignItems:"center" },
  calibScaleName: { fontSize:18, color:"#C9A84C", fontWeight:700 },
  calibProgress: { fontSize:13, color:"#666" },
  progressBar: { height:4, background:"#2a2010", borderRadius:2, overflow:"hidden" },
  progressFill: { height:"100%", background:"#C9A84C", transition:"width 0.4s ease", borderRadius:2 },
  scaleDisplay: { display:"flex", gap:6, flexWrap:"wrap", justifyContent:"center", padding:"16px 0" },
  scaleNote: {
    width:44, height:44, display:"flex", alignItems:"center", justifyContent:"center",
    background:"#1e1a14", border:"1px solid #3a2e1e", borderRadius:8,
    color:"#888", fontSize:13, fontWeight:700, transition:"all 0.2s",
  },
  scaleNoteHit: { background:"#C9A84C22", border:"1px solid #C9A84C", color:"#C9A84C" },
  freqDisplay: {
    display:"flex", gap:12, alignItems:"center", justifyContent:"center",
    padding:"12px", background:"#1a1610", borderRadius:8, border:"1px solid #2a2010",
  },
  freqHz: { fontSize:22, color:"#e8d9b0", fontFamily:"monospace" },
  freqNote: { fontSize:16, color:"#C9A84C", fontWeight:700 },
  mainBg: { minHeight:"100vh", background:"#0e0c09", display:"flex", flexDirection:"column", fontFamily:"'Georgia', serif" },
  topBar: {
    height:56, background:"#13100d", borderBottom:"1px solid #2a2010",
    display:"flex", alignItems:"center", justifyContent:"space-between",
    padding:"0 20px", flexShrink:0, position:"sticky", top:0, zIndex:100,
  },
  topBrand: { display:"flex", alignItems:"center", gap:10 },
  topBrandName: { fontSize:18, fontWeight:700, color:"#C9A84C", letterSpacing:"0.05em" },
  topControls: { display:"flex", alignItems:"center", gap:12 },
  uploadBtn: {
    background:"#1e1a14", border:"1px solid #3a2e1e", borderRadius:8,
    padding:"7px 14px", color:"#a89060", fontSize:13, cursor:"pointer",
  },
  micBtn: {
    background:"#1e1a14", border:"1px solid #3a2e1e", borderRadius:8,
    padding:"7px 14px", color:"#a89060", fontSize:13, cursor:"pointer",
  },
  micBtnActive: { background:"#2a0a0a", border:"1px solid #aa3333", color:"#ee6666" },
  topToggle: { display:"flex", alignItems:"center", color:"#887060", fontSize:13, cursor:"pointer" },
  userBadge: { display:"flex", alignItems:"center", gap:8, cursor:"pointer", padding:"4px 10px", borderRadius:8,
    border:"1px solid #2a2010", background:"#1a1610" },
  avatar: {
    width:28, height:28, borderRadius:"50%", background:"#C9A84C", color:"#1a1200",
    display:"flex", alignItems:"center", justifyContent:"center", fontWeight:700, fontSize:13,
  },
  userName: { color:"#a89060", fontSize:13 },
  profileDrop: {
    position:"absolute", top:58, right:20, background:"#181410", border:"1px solid #2e2416",
    borderRadius:10, padding:16, minWidth:200, zIndex:200,
    boxShadow:"0 16px 48px rgba(0,0,0,0.7)", display:"flex", flexDirection:"column", gap:8,
  },
  profileItem: { color:"#a89060", fontSize:13 },
  profileBtn: {
    background:"#1e1a14", border:"1px solid #3a2e1e", borderRadius:8,
    padding:"7px 12px", color:"#a89060", fontSize:13, cursor:"pointer", textAlign:"left",
  },
  mainBody: { display:"flex", flex:1, overflow:"hidden", height:"calc(100vh - 56px)" },
  scorePanel: {
    flex:1, overflow:"auto", background:"#0e0c09", padding:24,
    scrollBehavior:"smooth",
  },
  scorePlaceholder: {
    display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center",
    height:"100%", gap:16,
  },
  placeholderIcon: { fontSize:80, color:"#2a2010", lineHeight:1 },
  placeholderText: { fontSize:18, color:"#4a3820" },
  placeholderSub: { fontSize:13, color:"#3a2e18", textAlign:"center", lineHeight:1.7 },
  pdfFrame: { width:"100%", height:"100%", border:"none", borderRadius:4 },
  osmdContainer: { background:"white", borderRadius:8, padding:16, minHeight:400 },
  osmdError: { color:"#ee5555", fontSize:13, marginBottom:8, padding:8, background:"#2a1111", borderRadius:6 },
  rightPanel: {
    width:260, background:"#13100d", borderLeft:"1px solid #2a2010",
    display:"flex", flexDirection:"column", gap:0, overflow:"auto",
  },
  pitchCard: {
    padding:16, borderBottom:"1px solid #1e1810", display:"flex",
    flexDirection:"column", alignItems:"center", gap:4,
  },
  pitchTitle: { fontSize:11, textTransform:"uppercase", letterSpacing:"0.1em", color:"#554030", fontWeight:700 },
  bigNote: { fontSize:44, color:"#C9A84C", fontWeight:700, lineHeight:1 },
  freqLine: { fontSize:12, color:"#666", fontFamily:"monospace" },
  tunerTrack: {
    width:"100%", height:6, background:"#1e1810", borderRadius:3, position:"relative", margin:"6px 0",
  },
  tunerNeedle: {
    position:"absolute", top:-2, width:10, height:10, borderRadius:"50%", transform:"translateX(-50%)",
    transition:"left 0.1s ease, background 0.2s",
  },
  tunerCenter: {
    position:"absolute", top:-3, left:"50%", width:1, height:12, background:"#3a3020", transform:"translateX(-50%)",
  },
  centsLabel: { fontSize:12, fontFamily:"monospace", fontWeight:700 },
  pitchIdle: { color:"#443828", fontSize:13, padding:"12px 0", textAlign:"center" },
  historyCard: { padding:12, borderBottom:"1px solid #1e1810" },
  historyScroll: { display:"flex", flexWrap:"wrap", gap:4, marginTop:6 },
  historyNote: {
    fontSize:11, color:"#C9A84C", background:"#1e1608", border:"1px solid #2e2010",
    borderRadius:4, padding:"2px 6px", fontFamily:"monospace",
  },
  sidebarTabs: { display:"flex", borderBottom:"1px solid #1e1810" },
  sidebarTab: {
    flex:1, padding:"8px 0", background:"none", border:"none", color:"#554030",
    fontSize:12, cursor:"pointer", fontFamily:"inherit",
  },
  sidebarTabActive: { color:"#C9A84C", borderBottom:"2px solid #C9A84C" },
  markingsCard: { padding:12, flex:1 },
  markingItem: { display:"flex", flexWrap:"wrap", gap:4, padding:"6px 0", borderBottom:"1px solid #1a1610", alignItems:"center" },
  markingType: { fontSize:12, color:"#a89060", fontWeight:700 },
  markingCount: { fontSize:11, color:"#C9A84C", background:"#1e1608", borderRadius:4, padding:"1px 5px" },
  markingDetail: { fontSize:11, color:"#665040", flex:"1 1 100%", paddingLeft:2 },
  infoRow: { display:"flex", justifyContent:"space-between", padding:"6px 0", borderBottom:"1px solid #1a1610" },
  infoLabel: { fontSize:12, color:"#665040" },
  infoVal: { fontSize:12, color:"#a89060", textAlign:"right", maxWidth:140 },
  settingRow: { display:"flex", alignItems:"center", padding:"8px 0", borderBottom:"1px solid #1a1610", gap:8 },
  alertBanner: {
    background:"#d4a574", color:"#1a1200", padding:"12px 16px", textAlign:"center",
    fontSize:13, fontWeight:700, position:"relative", zIndex:99,
  },
  tempoPrompter: {
    position:"fixed", bottom:20, left:"50%", transform:"translateX(-50%)",
    background:"#181410", border:"2px solid #C9A84C", borderRadius:12, padding:20,
    textAlign:"center", zIndex:300, minWidth:240, boxShadow:"0 16px 48px rgba(0,0,0,0.8)",
  },
  tempoTitle: { fontSize:20, color:"#C9A84C", fontWeight:700, marginBottom:6 },
  tempoSubtitle: { fontSize:14, color:"#a89060", marginBottom:12 },
  tempoBtn: {
    background:"#C9A84C", color:"#1a1200", border:"none", borderRadius:6,
    padding:"8px 16px", fontSize:12, fontWeight:700, cursor:"pointer",
  },
  markingSuggestionsBanner: {
    background:"#2a2418", color:"#d4af9f", padding:"12px 16px", textAlign:"left",
    fontSize:13, position:"relative", zIndex:98, borderBottom:"1px solid #3a2e1e",
  },
  stickyNotesOverlay: {
    position:"absolute", top:0, left:0, right:0, bottom:0, pointerEvents:"none", zIndex:97,
  },
  stickyNote: {
    position:"absolute", width:120, minHeight:60, padding:"8px 10px", borderRadius:6,
    boxShadow:"0 4px 12px rgba(0,0,0,0.3)", cursor:"pointer", pointerEvents:"auto",
    border:"2px solid #C9A84C", transform:"rotate(-2deg)",
  },
  stickyNoteText: {
    fontSize:11, color:"#1a1200", lineHeight:1.3, wordWrap:"break-word",
  },
  stickyNoteMeasure: {
    fontSize:9, color:"#665040", marginTop:4, textAlign:"right", fontWeight:700,
  },
  stickyNoteModeOverlay: {
    position:"absolute", top:0, left:0, right:0, bottom:0, background:"rgba(201, 168, 76, 0.1)",
    cursor:"crosshair", zIndex:96, display:"flex", alignItems:"center", justifyContent:"center",
  },
  stickyNoteModeHint: {
    background:"#C9A84C", color:"#1a1200", padding:"8px 16px", borderRadius:6,
    fontSize:12, fontWeight:700, boxShadow:"0 4px 16px rgba(0,0,0,0.4)",
  },
};
