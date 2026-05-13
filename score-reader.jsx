import { useState, useEffect, useRef, useCallback } from "react";

// Backend API helpers

const MIN_NOTE_STABILITY_MS = 80;

async function apiRequest(path, options = {}) {
  const response = await fetch(path, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  if (response.status === 204) return null;
  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;
  if (!response.ok) {
    const message = payload?.detail || payload?.message || response.statusText;
    throw new Error(Array.isArray(message) ? message.map(m => m.msg || m).join(", ") : message);
  }
  return payload;
}

function normalizeProfile(profile) {
  if (!profile) return { instrument: "Concert (C)", calibration: { skipped: true } };
  return {
    instrument: profile.instrument || "Concert (C)",
    transposition: profile.transposition || 0,
    calibration: profile.calibrated ? { saved: true } : { skipped: true },
  };
}

function scaleTypeForName(name) {
  if (!name) return "major";
  const lower = name.toLowerCase();
  if (lower.includes("v1")) return "meyer_v1";
  if (lower.includes("v2")) return "meyer_v2";
  if (lower.includes("v3")) return "meyer_v3";
  return "major";
}

function calibrationToRequest(calibration) {
  return {
    sessions: Object.entries(calibration || {})
      .filter(([, value]) => value && !value.skipped)
      .map(([scaleName, value]) => ({
        scale_name: scaleName,
        scale_type: scaleTypeForName(scaleName),
        scale_root: 0,
        notes: (value.detectedNotes || []).map((note_name, seq_index) => ({
          note_name,
          detected_freq: 0,
          cents_deviation: 0,
          seq_index,
        })),
      })),
  };
}

//  App

export default function App() {
  const [screen, setScreen] = useState("auth");
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [authMode, setAuthMode] = useState("login");
  const [authForm, setAuthForm] = useState({ email: "", password: "", name: "" });
  const [authError, setAuthError] = useState("");
  const [authLoading, setAuthLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    apiRequest("/auth/me")
      .then(payload => {
        if (cancelled) return;
        setUser({ id: payload.id, email: payload.email, name: payload.name });
        setProfile(normalizeProfile(payload.profile));
        setScreen("main");
      })
      .catch(() => { if (!cancelled) setScreen("auth"); })
      .finally(() => { if (!cancelled) setAuthLoading(false); });
    return () => { cancelled = true; };
  }, []);

  async function handleLogin() {
    setAuthError("");
    try {
      const payload = await apiRequest("/auth/login", { method: "POST", body: JSON.stringify({ email: authForm.email, password: authForm.password }) });
      const me = await apiRequest("/auth/me").catch(() => ({ ...payload, id: payload.user_id, profile: null }));
      setUser({ id: me.id || payload.user_id, email: me.email, name: me.name });
      setProfile(normalizeProfile(me.profile));
      setScreen("main");
    } catch (err) {
      setAuthError(err.message || "Sign in failed.");
    }
  }

  async function handleSignup() {
    if (!authForm.email || !authForm.password || !authForm.name) { setAuthError("All fields required."); return; }
    setAuthError("");
    try {
      const payload = await apiRequest("/auth/register", { method: "POST", body: JSON.stringify({ email: authForm.email, password: authForm.password, name: authForm.name }) });
      setUser({ id: payload.user_id, email: payload.email, name: payload.name });
      setProfile({ instrument: "Concert (C)", calibration: { skipped: true } });
      setScreen("instrument");
    } catch (err) {
      setAuthError(err.message || "Account creation failed.");
    }
  }

  async function handleLogout() {
    await apiRequest("/auth/logout", { method: "POST" }).catch(() => null);
    setUser(null); setProfile(null); setScreen("auth");
  }

  async function handleInstrumentSave(instr) {
    try {
      await apiRequest("/profile/instrument", { method: "PUT", body: JSON.stringify({ instrument: instr }) });
      setProfile(prev => ({ ...prev, instrument: instr, calibration: prev?.calibration || { skipped: true } }));
      setScreen("main");
    } catch (err) {
      setAuthError(err.message || "Could not save instrument.");
    }
  }

  async function handleCalibrationDone(calibration) {
    const payload = calibrationToRequest(calibration);
    if (payload.sessions.length) await apiRequest("/profile/calibration", { method: "POST", body: JSON.stringify(payload) }).catch(() => null);
    setProfile(prev => ({ ...prev, calibration: payload.sessions.length ? { saved: true } : { skipped: true } }));
    setScreen("main");
  }

  function handleSkipCalibration() {
    setProfile(prev => ({ ...prev, calibration: { skipped: true } }));
    setScreen("main");
  }

  if (authLoading) return <div style={styles.authBg}><div style={styles.authCard}><span style={styles.authBrand}>ScoreSync</span></div></div>;
  if (screen === "auth") return <AuthScreen mode={authMode} form={authForm} error={authError}
    onFormChange={f => setAuthForm(f)} onLogin={handleLogin} onSignup={handleSignup}
    onToggleMode={() => { setAuthMode(m => m === "login" ? "signup" : "login"); setAuthError(""); }} />;
  if (screen === "instrument") return <InstrumentScreen onSave={handleInstrumentSave} />;
  if (screen === "calibrate") return <CalibrationScreen instrument={profile.instrument} onDone={handleCalibrationDone} onSkip={handleSkipCalibration} />;
  return <MainScreen user={user} profile={profile} onLogout={handleLogout} onRecalibrate={() => setScreen("calibrate")} />;
}

//  Auth Screen

function AuthScreen({ mode, form, error, onFormChange, onLogin, onSignup, onToggleMode }) {
  const isLogin = mode === "login";
  return (
    <div style={styles.authBg}>
      <div style={styles.authCard}>
        <div style={styles.authLogo}>
          <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
            <circle cx="20" cy="20" r="20" fill="#C9A84C"/>
            <text x="20" y="26" textAnchor="middle" fontSize="18" fill="#1a1a1a" fontFamily="serif">S</text>
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

//  Instrument Screen

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
             Transposes {Math.abs(TRANSPOSITIONS[selected])} semitone{Math.abs(TRANSPOSITIONS[selected])!==1?"s":""} {TRANSPOSITIONS[selected]>0?"up":"down"} from concert
          </div>
        )}
        <button style={{...styles.authBtn, marginTop: 24}} onClick={() => onSave(selected)}>
          Continue
        </button>
      </div>
    </div>
  );
}

//  Calibration Screen

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
              Calibration is optional. You can play a few scales now, or skip and let ScoreSync learn your tuning tendencies during practice.
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
                <span style={{color:"#666"}}>Play the scale above ascending and descending</span>
              )}
            </div>

            <div style={{display:"flex", gap:12, marginTop:20, justifyContent:"center"}}>
              {!isListening ? (
                <button style={styles.authBtn} onClick={startMic}>Start Listening</button>
              ) : (
                <>
                  <button style={{...styles.authBtn, background:"#2a5"}} onClick={handleSaveAndNext}>
                    Save & Next Scale
                  </button>
                  <button style={{...styles.authToggle}} onClick={stopMic}>Stop Mic</button>
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

//  Main Screen

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
  const [showComposer, setShowComposer] = useState(false);
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
  const [wakeWordNotice, setWakeWordNotice] = useState(null);
  const [voiceRecognitionActive, setVoiceRecognitionActive] = useState(false);
  const [stickyNoteMode, setStickyNoteMode] = useState(false);
  const [errorMessage, setErrorMessage] = useState(null);
  const [loadingSynthesis, setLoadingSynthesis] = useState(false);
  const [loadingMetronome, setLoadingMetronome] = useState(false);
  const [numberOfSegments, setNumberOfSegments] = useState(4);
  const scoreContainerRef = useRef(null);
  const wakeCountdownTimerRef = useRef(null);
  const audioCtxRef = useRef(null);
  const analyserRef = useRef(null);
  const streamRef = useRef(null);
  const rafRef = useRef(null);
  const bufRef = useRef(null);
  const osmdRef = useRef(null);
  const osmdContainerRef = useRef(null);
  const noteHistoryRef = useRef([]);
  const freqHistoryRef = useRef([]);
  const lastRmsRef = useRef(0);
  const noteStableSinceRef = useRef(null);
  const previousNoteRef = useRef(null);
  const frameCounterRef = useRef(0);
  const [noteHistory, setNoteHistory] = useState([]);
  const [rmsLevel, setRmsLevel] = useState(0);
  const [spectralCentroid, setSpectralCentroid] = useState(0);
  const [spectralFlatness, setSpectralFlatness] = useState(0);
  const [attackMs, setAttackMs] = useState(0);
  const [releaseMs, setReleaseMs] = useState(0);
  const [vibratoStrength, setVibratoStrength] = useState(0);
  const [performanceArticulation, setPerformanceArticulation] = useState("");
  const getOsmdMeasureIndex = useCallback(() => {
    const iterator = osmdRef.current?.cursor?.iterator;
    const raw = iterator?.CurrentMeasureIndex ?? iterator?.currentMeasureIndex;
    return Number.isFinite(raw) ? raw : currentMeasure - 1;
  }, [currentMeasure]);

  const scrollToOsmdCursor = useCallback(() => {
    const container = scoreContainerRef.current;
    const cursorElement = osmdRef.current?.cursor?.cursorElement;
    if (!container || !cursorElement) return false;
    const top = cursorElement.offsetTop || cursorElement.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop;
    container.scrollTo({ top: Math.max(0, top - container.clientHeight * 0.25), behavior: "smooth" });
    return true;
  }, []);

  const scrollToMeasure = useCallback((measureNumber) => {
    const osmd = osmdRef.current;
    if (!osmd || !scoreContainerRef.current) return;
    const cursor = osmd.cursor;
    try {
      cursor?.reset?.();
      cursor?.show?.();
      const targetIndex = Math.max(0, measureNumber - 1);
      let guard = 0;
      while ((cursor?.iterator?.CurrentMeasureIndex ?? 0) < targetIndex && guard < 2048) {
        cursor.next();
        guard += 1;
      }
      scrollToOsmdCursor();
      setCurrentMeasure((cursor?.iterator?.CurrentMeasureIndex ?? targetIndex) + 1);
    } catch {
      scrollToOsmdCursor();
    }
  }, [scrollToOsmdCursor]);

  const advanceOsmdCursor = useCallback(() => {
    const cursor = osmdRef.current?.cursor;
    if (!cursor) return;
    try {
      cursor.show?.();
      cursor.next();
      const measureIndex = cursor.iterator?.CurrentMeasureIndex ?? cursor.iterator?.currentMeasureIndex;
      if (Number.isFinite(measureIndex)) setCurrentMeasure(measureIndex + 1);
      scrollToOsmdCursor();
    } catch {
      scrollToOsmdCursor();
    }
  }, [scrollToOsmdCursor]);

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
    liveAnalysisEnabled: true,
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
        osmd.cursor?.show?.();
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
      setErrorMessage("Supported: .pdf, .xml, .musicxml, .mxl, .mscz, .mscx");
    }
    e.target.value = "";
  }

  const startMetronome = useCallback(async () => {
    if (!rhythmInfo) return;
    setLoadingMetronome(true);
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
      } else {
        const errorText = await response.text();
        setErrorMessage(`Metronome error: ${errorText}`);
      }
    } catch (e) {
      setErrorMessage(`Metronome failed: ${e.message}`);
    } finally {
      setLoadingMetronome(false);
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
    const y = event.clientY - rect.top;

    const newNote = {
      id: Date.now(),
      x: x,
      y: y,
      measure: currentMeasure,
      text: '',
      color: '#FFFF88',
      editing: true
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

  const beginWakeWordResume = useCallback((measureNumber) => {
    const targetMeasure = Math.max(1, measureNumber - 1);
    setWakeWordNotice({ measure: targetMeasure, countdown: 4 });
    let count = 4;
    const interval = rhythmInfo ? (60 / rhythmInfo.tempo_bpm) * 1000 : 1000; // based on tempo
    const timer = setInterval(() => {
      count--;
      setWakeWordNotice(prev => prev ? { ...prev, countdown: count } : null);
      if (count <= 0) {
        clearInterval(timer);
        setCurrentMeasure(targetMeasure);
        setIsAutoScrollPaused(false);
        if (scoreContainerRef.current) {
          scrollToMeasure(targetMeasure);
        }
        setWakeWordNotice(null);
      }
    }, interval);
    wakeCountdownTimerRef.current = timer;
  }, [rhythmInfo, scrollToMeasure]);

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
        const targetMeasure = Math.max(1, measureNumber + 4);
        setCurrentMeasure(targetMeasure);
        setIsAutoScrollPaused(false);
        if (scoreContainerRef.current) {
          scrollToMeasure(targetMeasure);
        }
      }, (measureNumber) => {
        beginWakeWordResume(measureNumber);
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
  }, [settings.voiceMeasureJumpEnabled, isListening, beginWakeWordResume, scrollToMeasure]);

  // Update metronome BPM when rhythm info changes
  useEffect(() => {
    if (rhythmInfo?.tempo_bpm) {
      setMetronomeState(prev => ({ ...prev, bpm: rhythmInfo.tempo_bpm }));
    }
  }, [rhythmInfo]);

  // Generate marking suggestions based on current measure
  useEffect(() => {
    if (settings.markingSuggestionsEnabled && rhythmInfo && complexMarkings.length > 0) {
      const metrics = settings.liveAnalysisEnabled ? {
        rmsLevel,
        spectralCentroid,
        spectralFlatness,
        attackMs,
        releaseMs,
        hasVibrato: vibratoStrength > 0.4,
        vibratoStrength,
        noteCharacter: performanceArticulation,
      } : null;
      const suggestions = generateMarkingSuggestions(currentMeasure, rhythmInfo, complexMarkings, metrics);
      setMarkingSuggestions(suggestions);
    } else {
      setMarkingSuggestions([]);
    }
  }, [currentMeasure, settings.markingSuggestionsEnabled, settings.liveAnalysisEnabled, rhythmInfo, complexMarkings, rmsLevel, spectralCentroid, spectralFlatness, attackMs, releaseMs, vibratoStrength, performanceArticulation]);

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
    } catch { setErrorMessage("Microphone access is required for pitch detection."); }
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
      const currentRms = computeRMS(bufRef.current);
      setRmsLevel(currentRms);

      const freq = yin(bufRef.current, audioCtxRef.current.sampleRate);
      const now = Date.now();
      if (freq > 40 && freq < 4200) {
        const midi = freqToMidi(freq);
        const noteLabel = freqToNoteLabel(freq);
        if (previousNoteRef.current !== noteLabel) {
          noteStableSinceRef.current = now;
          previousNoteRef.current = noteLabel;
        }
        const sustainMs = noteStableSinceRef.current ? now - noteStableSinceRef.current : 0;
        if (sustainMs < MIN_NOTE_STABILITY_MS) {
          rafRef.current = requestAnimationFrame(loop);
          return;
        }
        setCurrentFreq(freq);
        setCurrentMidi(midi);
        setCurrentNote(noteLabel);
        setCents(centsDiff(freq, midi));
        const lastEntry = noteHistoryRef.current[noteHistoryRef.current.length - 1];
        const entry = { freq, note: noteLabel, time: now };
        if (!lastEntry || lastEntry.note !== noteLabel || now - lastEntry.time > MIN_NOTE_STABILITY_MS) {
          noteHistoryRef.current = [...noteHistoryRef.current.slice(-49), entry];
          setNoteHistory([...noteHistoryRef.current]);
          advanceOsmdCursor();
        }

        const freqHistory = [...freqHistoryRef.current.slice(-49), freq];
        freqHistoryRef.current = freqHistory;
        const vibrato = detectVibratoFromHistory(freqHistory, audioCtxRef.current.sampleRate);
        setVibratoStrength(vibrato.rate || 0);

        const spectrum = new Float32Array(analyserRef.current.frequencyBinCount);
        analyserRef.current.getFloatFrequencyData(spectrum);
        const centroid = computeSpectralCentroid(spectrum, audioCtxRef.current.sampleRate);
        setSpectralCentroid(centroid);
        setSpectralFlatness(computeSpectralFlatness(spectrum));

        const attackDelta = currentRms - lastRmsRef.current;
        const attackTime = attackDelta > 0.05 ? 30 : 120;
        setAttackMs(attackTime);
        const releaseTime = attackDelta < -0.05 ? 80 : 180;
        setReleaseMs(releaseTime);
        lastRmsRef.current = currentRms;

        let noteCharacter = "plain";
        if (attackTime < 50 && releaseTime < 120) noteCharacter = "staccato";
        else if (sustainMs > 400 && currentRms > 0.02) noteCharacter = "legato";
        else if (currentRms > 0.15 && attackDelta > 0.08) noteCharacter = "accent";
        else if (sustainMs > 600) noteCharacter = "tenuto";
        setPerformanceArticulation(noteCharacter);

        if (settings.restAlertEnabled && restAlerts.length > 0 && rhythmInfo) {
          const currentMeasureEstimate = getOsmdMeasureIndex() + 1;
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
  }, [isListening, settings, restAlerts, rhythmInfo, advanceOsmdCursor, getOsmdMeasureIndex]);

  useEffect(() => {
    if (!autoScroll || !isListening || !scoreContainerRef.current) return;
    const id = setInterval(() => {
      if (isAutoScrollPaused) return;
      if (currentFreq > 0) {
        scrollToOsmdCursor();
      } else if (settings.pauseOnSilence) {
        setIsAutoScrollPaused(true);
      }
    }, 120);
    return () => clearInterval(id);
  }, [autoScroll, isListening, currentFreq, isAutoScrollPaused, settings.pauseOnSilence, scrollToOsmdCursor]);

  const tunerColor = Math.abs(cents) < 10 ? "#2aee6e" : Math.abs(cents) < 25 ? "#f5c542" : "#ee4444";
  const tunerOffset = Math.max(-50, Math.min(50, cents));

  return (
    <div style={styles.mainBg}>
      <div style={styles.topBar}>
        <div style={styles.topBrand}>
          <svg width="28" height="28" viewBox="0 0 40 40" fill="none">
            <circle cx="20" cy="20" r="20" fill="#C9A84C"/>
            <text x="20" y="27" textAnchor="middle" fontSize="20" fill="#1a1a1a" fontFamily="serif"></text>
          </svg>
          <span style={styles.topBrandName}>ScoreSync</span>
        </div>
        <div style={styles.topControls}>
          <label style={styles.uploadBtn}>
            Load Score
            <input type="file" accept=".pdf,.xml,.musicxml,.mxl,.mscz,.mscx" style={{display:"none"}} onChange={handleFileLoad}/>
          </label>
          <button style={{...styles.micBtn, ...(showComposer ? {background:"#C9A84C22", border:"1px solid #C9A84C", color:"#C9A84C"} : {})}}
            onClick={() => setShowComposer(v => !v)}>
            ✍ Compose
          </button>
          <button style={{...styles.micBtn, ...(isListening ? styles.micBtnActive : {})}}
            onClick={isListening ? stopMic : startMic}>
            {isListening ? "Stop Mic" : "Start Mic"}
          </button>
          <label style={styles.topToggle}>
            <input type="checkbox" checked={autoScroll} onChange={e => setAutoScroll(e.target.checked)} style={{marginRight:6}}/>
            Auto-scroll
          </label>
          {isAutoScrollPaused && (
            <button style={{...styles.micBtn, background:"#2a5", border:"1px solid #4a9"}} onClick={() => setIsAutoScrollPaused(false)}>
              Resume
            </button>
          )}
          {loopMode !== "none" && (
            <span style={{fontSize:11, color:"#C9A84C", padding:"4px 8px", background:"#2a2010", borderRadius:4}}>
               {loopMode === "measure" ? "Measure Loop" : "Phrase Loop"}
            </span>
          )}
          <button style={{...styles.micBtn, ...(stickyNoteMode ? {background:"#C9A84C", color:"#1a1200"} : {})}}
            onClick={() => setStickyNoteMode(!stickyNoteMode)}>
            {stickyNoteMode ? "Exit Notes" : "Sticky Notes"}
          </button>
          {voiceRecognitionActive && (
            <span style={{fontSize:11, color:"#2aee6e", padding:"4px 8px", background:"#1a2a1a", borderRadius:4}}>
              Voice Active
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
          <div style={styles.profileItem}>{profile.instrument}</div>
          <button style={styles.profileBtn} onClick={onRecalibrate}>Recalibrate</button>
          <button style={{...styles.profileBtn, color:"#ee4444"}} onClick={onLogout}>Sign Out</button>
        </div>
      )}

      {errorMessage && (
        <div style={styles.errorBanner}>
          <span>{errorMessage}</span>
          <button style={styles.errorDismiss} onClick={() => setErrorMessage(null)}>Dismiss</button>
        </div>
      )}

      {/* Rest Alert Notification */}
      {currentRestAlert && settings.restAlertEnabled && (
        <div style={{...styles.alertBanner}}>
          Rest Alert: Measure {currentRestAlert.measure} in {currentRestAlert.beatsUntil.toFixed(1)} beat(s)
        </div>
      )}

      {/* Tempo Prompter */}
      {tempoPrompt && rhythmInfo && (
        <div style={styles.tempoPrompter}>
          <div style={styles.tempoTitle}>Tempo: {metronomeState.bpm} BPM</div>
          <div style={styles.tempoSubtitle}>{rhythmInfo.time_signature}</div>
          <div style={{display:"flex", gap:8, marginTop:12, justifyContent:"center"}}>
            <button style={styles.tempoBtn} onClick={startMetronome}>
              {metronomeState.isPlaying ? "Stop" : "Play Metronome"}
            </button>
            <button style={{...styles.tempoBtn, background:"#1e1a14"}} onClick={() => setTempoPrompt(false)}>
              Ready
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
                REST ALERT - Measure {currentRestAlert.measure}
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
                Performance Suggestions
              </div>
              {markingSuggestions.slice(0,2).map((suggestion, i) => (
                <div key={i} style={{fontSize:12, color:"#d4af9f", marginBottom:2}}>
                   {suggestion.suggestion}
                </div>
              ))}
              {performanceArticulation && (
                <div style={{fontSize:11, color:"#b9a46a", marginTop:6}}>
                  Live analysis: {performanceArticulation} character detected
                </div>
              )}
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
                    if (note.editing) {
                      // Save on click outside or something, but for now, toggle
                    } else {
                      updateStickyNote(note.id, { editing: true });
                    }
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    if (confirm('Delete this sticky note?')) {
                      deleteStickyNote(note.id);
                    }
                  }}
                >
                  {note.editing ? (
                    <input
                      style={styles.stickyNoteInput}
                      value={note.text}
                      onChange={(e) => updateStickyNote(note.id, { text: e.target.value })}
                      onBlur={() => updateStickyNote(note.id, { editing: false })}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          updateStickyNote(note.id, { editing: false });
                        }
                      }}
                      autoFocus
                    />
                  ) : (
                    <div style={styles.stickyNoteText}>{note.text || 'Click to edit'}</div>
                  )}
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
                 Click anywhere on the score to add a sticky note
              </div>
            </div>
          )}
          {!score ? (
            <div style={styles.scorePlaceholder}>
              <div style={styles.placeholderIcon}>S</div>
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
              <div style={styles.placeholderIcon}>MS</div>
              <div style={styles.placeholderText}>MuseScore file detected</div>
              <div style={styles.placeholderSub}>MuseScore files can be converted by the connected backend when MuseScore CLI is configured.</div>
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
                  {cents > 0 ? "+" : ""}{cents.toFixed(1)} cents
                </div>
              </>
            ) : (
              <div style={styles.pitchIdle}>
                {isListening ? "Listening" : "Start mic to detect pitch"}
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
                  <span style={styles.markingCount}>x{m.count}</span>
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
                        Tempo: {rhythmInfo.tempo_bpm} BPM | Time: {rhythmInfo.time_signature}<br/>
                        Notes: {rhythmInfo.note_count} | Rests: {rhythmInfo.rest_count}<br/>
                        Current Measure: {currentMeasure}
                      </div>

                      <div style={{marginTop:12, marginBottom:8}}>
                        <div style={{fontSize:11, color:"#a89060", marginBottom:6}}>Playback Controls</div>
                        <div style={{display:"flex", gap:6, marginBottom:8}}>
                          <button style={{...styles.profileBtn, flex:1, fontSize:11}}
                            disabled={loadingSynthesis}
                            onClick={async () => {
                              if (!score || scoreType !== "musicxml") return;
                              setLoadingSynthesis(true);
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
                                  const errorText = await response.text();
                                  setErrorMessage(`Synthesis failed: ${errorText}`);
                                }
                              } catch (err) {
                                setErrorMessage(`Synthesis error: ${err.message}`);
                              } finally {
                                setLoadingSynthesis(false);
                              }
                            }}>
                            {loadingSynthesis ? "Synthesizing..." : "Synth Track"}
                          </button>
                          <button style={{...styles.profileBtn, flex:1, fontSize:11, background:"#2a5"}}
                            onClick={() => {
                              if (audioElementRef.current) {
                                audioElementRef.current.pause();
                                audioElementRef.current.currentTime = 0;
                              }
                            }}>
                             Stop
                          </button>
                        </div>
                      </div>

                      <button style={{...styles.profileBtn, marginTop:6, width:"100%", background:"#1e1a14"}}
                        onClick={async () => {
                          if (!score || scoreType !== "musicxml") return;
                          const form = new FormData();
                          form.append("file", new Blob([score], { type: "application/xml" }), "score.xml");
                          form.append("segment_size", String(numberOfSegments));
                          try {
                            const response = await fetch("/scores/training/segments", { method: "POST", body: form });
                            if (response.ok) {
                              const payload = await response.json();
                              setTrainingSegments(payload.segments || []);
                            } else {
                              const errorText = await response.text();
                              setErrorMessage(`Segment extraction failed: ${errorText}`);
                            }
                          } catch (err) {
                            setErrorMessage(`Segment error: ${err.message}`);
                          }
                        }}>
                        Extract Segments
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
                                    scrollToMeasure(segment.start_measure);
                                  }
                                }}>
                                <div style={{fontWeight:700}}>Segment {segment.segment_id}: M{segment.start_measure}-{segment.end_measure}</div>
                                <div style={{fontSize:11, color:"#8e7b55", marginTop:2}}>
                                  {segment.measure_count} measures - rests: {segment.markings.hasRests ? "yes" : "no"}, accents: {segment.markings.hasAccents ? "yes" : "no"}
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
                    Tempo: {rhythmInfo.tempo_bpm} BPM | Time: {rhythmInfo.time_signature}
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
                             Start
                          </button>
                          <button style={{...styles.profileBtn, flex:1, fontSize:11, background:"#a52"}}
                            onClick={stopMetronome}>
                             Stop
                          </button>
                        </div>
                      </div>

                      <button style={{...styles.profileBtn, marginTop:6, width:"100%", background:"#1e1a14"}}
                        onClick={async () => {
                          try {
                            const params = new URLSearchParams({
                              bpm: String(rhythmInfo.tempo_bpm),
                              time_signature: rhythmInfo.time_signature,
                              duration_seconds: "30",
                              accent_first: "true"
                            });
                            const response = await fetch(`/playback/metronome?${params}`, { method: "POST" });
                            if (response.ok) {
                              const blob = await response.blob();
                              const url = URL.createObjectURL(blob);
                              if (audioElementRef.current) {
                                audioElementRef.current.src = url;
                                await audioElementRef.current.play();
                              }
                            } else {
                              setErrorMessage(`Metronome generation failed: ${await response.text()}`);
                            }
                          } catch (err) {
                            setErrorMessage(`Metronome error: ${err.message}`);
                          }
                        }}>
                        Generate Metronome Track
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
              <div style={styles.settingRow}>
                <label style={{display:"flex", alignItems:"center", gap:6, cursor:"pointer"}}>
                  <input type="checkbox" checked={settings.liveAnalysisEnabled} onChange={e => setSettings({...settings, liveAnalysisEnabled: e.target.checked})} style={{marginRight:0}}/>
                  <span style={{fontSize:12, color:"#a89060"}}>Live performance analysis</span>
                </label>
              </div>
              {rhythmInfo && (
                <button style={{...styles.profileBtn, marginTop:12, width:"100%", background:"#C9A84C22", color:"#C9A84C", border:"1px solid #C9A84C"}} onClick={() => setTempoPrompt(true)}>
                  Start Tempo Prompt
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Hidden audio element for metronome */}
      <audio ref={audioElementRef} style={{display:"none"}}/>

      {/* Composer Overlay */}
      {showComposer && (
        <ComposerOverlay userId={user.id} onClose={() => setShowComposer(false)} />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ComposerOverlay — full-screen composer panel
// ─────────────────────────────────────────────────────────────────────────────

const PART_ROLES = [
  { id: "melody",         label: "Melody",          color: "#C9A84C" },
  { id: "counter_melody", label: "Counter Melody",   color: "#7ec8e3" },
  { id: "harmony",        label: "Harmony",          color: "#8adf9a" },
  { id: "bass",           label: "Bass",             color: "#e38a8a" },
  { id: "other",          label: "Other",            color: "#c8a0e3" },
];

const KEYS = ["C","C#","Db","D","D#","Eb","E","F","F#","Gb","G","G#","Ab","A","A#","Bb","B"];
const MODES = ["major","minor","dorian","mixolydian","pentatonic"];

const DRUM_ROWS = [
  { id: "crash",    label: "Crash",    color: "#e8d9b0" },
  { id: "open_hat", label: "Open Hat", color: "#c9e890" },
  { id: "hihat",    label: "Hi-Hat",   color: "#90d4e8" },
  { id: "tom",      label: "Tom",      color: "#d090e8" },
  { id: "snare",    label: "Snare",    color: "#e8b090" },
  { id: "kick",     label: "Kick",     color: "#C9A84C" },
];

// Piano key layout for one octave
const PIANO_WHITES = ["C","D","E","F","G","A","B"];
const PIANO_BLACKS = { 1:"C#", 2:"D#", 4:"F#", 5:"G#", 6:"A#" }; // index into whites array

function noteLabel(midi) {
  const names = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];
  return names[midi % 12] + String(Math.floor(midi / 12) - 1);
}

function ComposerOverlay({ onClose }) {
  const [composerTab, setComposerTab] = useState("setup");
  const [compositions, setCompositions]   = useState([]);
  const [activeComp, setActiveComp]       = useState(null);
  const [setupForm, setSetupForm] = useState({ title:"New Piece", key:"C", mode:"major", tempo:120, time_signature:"4/4", measures:8 });
  const [selectedParts, setSelectedParts] = useState(["melody"]);
  const [generatingPart, setGeneratingPart] = useState(null);
  const [saveStatus, setSaveStatus] = useState("");
  const [error, setError] = useState("");
  const [isPlaying, setIsPlaying] = useState(false);

  // Drum state
  const [drumPattern, setDrumPattern] = useState(() => {
    const p = {};
    DRUM_ROWS.forEach(r => { p[r.id] = Array(16).fill(0); });
    return p;
  });
  const [drumSteps] = useState(16);

  // Piano roll state
  const [pianoRollPart, setPianoRollPart] = useState("melody");
  const [pianoRollCells, setPianoRollCells] = useState([]); // [{pitch_midi, measure, beat_16th, duration_16th}]
  const [pianoDrawing, setPianoDrawing] = useState(false);
  const [pianoEraseMode, setPianoEraseMode] = useState(false);

  const PIANO_MIDI_LOW  = 48; // C3
  const PIANO_MIDI_HIGH = 83; // B5
  const TOTAL_MIDI = PIANO_MIDI_HIGH - PIANO_MIDI_LOW + 1;
  const BEATS_16 = (activeComp?.measures || setupForm.measures) * 16;

  // ── Load compositions list on mount
  useEffect(() => {
    apiRequest("/composer/compositions")
      .then(setCompositions)
      .catch(() => {});
  }, []);

  async function createComposition() {
    try {
      const data = await apiRequest("/composer/compositions", {
        method: "POST",
        body: JSON.stringify(setupForm),
      });
      const full = await apiRequest(`/composer/compositions/${data.id}`);
      setActiveComp(full);
      setCompositions(prev => [{ ...full }, ...prev]);
      // Initialise selected parts
      const existingRoles = full.parts.map(p => p.role);
      setSelectedParts(existingRoles.length ? existingRoles : ["melody"]);
      if (full.drum_pattern) setDrumPattern(full.drum_pattern.pattern);
      setComposerTab("score");
    } catch (e) {
      setError(e.message);
    }
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
    } catch (e) {
      setError(e.message);
    }
  }

  async function generatePart(role) {
    if (!activeComp) return;
    setGeneratingPart(role);
    setError("");
    try {
      const genPath = role === "counter_melody"
        ? "/composer/generate/counter_melody"
        : role === "harmony" ? "/composer/generate/harmony"
        : role === "bass"    ? "/composer/generate/bass"
        : "/composer/generate/melody";
      const existingMelody = activeComp.parts.find(p => p.role === "melody")?.notes || [];
      const result = await apiRequest(genPath, {
        method: "POST",
        body: JSON.stringify({
          key: activeComp.key,
          mode: activeComp.mode,
          measures: activeComp.measures,
          tempo: activeComp.tempo,
          time_signature: activeComp.time_signature,
          existing_melody: existingMelody,
        }),
      });
      // Save the generated notes as a part
      await apiRequest(`/composer/compositions/${activeComp.id}/parts`, {
        method: "POST",
        body: JSON.stringify({ role: result.role, notes: result.notes }),
      });
      // Refresh
      const updated = await apiRequest(`/composer/compositions/${activeComp.id}`);
      setActiveComp(updated);
      setSaveStatus(`Generated ${role} (${result.engine})`);
    } catch (e) {
      setError(e.message);
    } finally {
      setGeneratingPart(null);
    }
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
    } catch (e) {
      setError(e.message);
    } finally {
      setGeneratingPart(null);
    }
  }

  async function saveDrumPattern() {
    if (!activeComp) return;
    try {
      await apiRequest(`/composer/compositions/${activeComp.id}/drum_pattern`, {
        method: "POST",
        body: JSON.stringify({ pattern: drumPattern, steps: drumSteps, swing: 0 }),
      });
      setSaveStatus("Drum pattern saved");
    } catch (e) {
      setError(e.message);
    }
  }

  async function savePianoRoll() {
    if (!activeComp) return;
    try {
      await apiRequest(`/composer/compositions/${activeComp.id}/piano_roll`, {
        method: "POST",
        body: JSON.stringify({ part_role: pianoRollPart, cells: pianoRollCells }),
      });
      setSaveStatus("Piano roll saved to project");
    } catch (e) {
      setError(e.message);
    }
  }

  async function exportXml() {
    if (!activeComp) return;
    window.open(`/composer/compositions/${activeComp.id}/export_xml`, "_blank");
  }

  async function deleteComposition(id) {
    if (!confirm("Delete this composition?")) return;
    await apiRequest(`/composer/compositions/${id}`, { method: "DELETE" }).catch(() => {});
    setCompositions(prev => prev.filter(c => c.id !== id));
    if (activeComp?.id === id) { setActiveComp(null); setComposerTab("setup"); }
  }

  // ── Drum toggle
  function toggleDrum(rowId, step) {
    setDrumPattern(prev => ({
      ...prev,
      [rowId]: prev[rowId].map((v, i) => i === step ? (v ? 0 : 1) : v),
    }));
  }

  // ── Piano roll helpers
  function pianoRollKey(midi, beat16) { return `${midi}_${beat16}`; }
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
        setPianoRollCells(prev => [...prev, { pitch_midi: midi, beat_16th: beat16, duration_16th: 1,
          measure: Math.floor(beat16 / 16) + 1 }]);
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
    title: { fontSize:16, fontWeight:700, color:"#C9A84C", flex:1 },
    tab: {
      padding:"14px 18px", background:"none", border:"none", color:"#554030",
      fontSize:13, cursor:"pointer", fontFamily:"inherit",
    },
    tabActive: { color:"#C9A84C", borderBottom:"2px solid #C9A84C" },
    body: { flex:1, overflow:"auto", padding:24, background:"#0e0c09" },
    card: {
      background:"#181410", border:"1px solid #2a2010", borderRadius:10,
      padding:16, marginBottom:16,
    },
    label: { fontSize:12, color:"#a89060", marginBottom:4, display:"block" },
    input: {
      background:"#1e1a14", border:"1px solid #3a2e1e", borderRadius:6,
      padding:"7px 10px", color:"#e8d9b0", fontSize:13, fontFamily:"inherit",
      width:"100%", boxSizing:"border-box",
    },
    select: {
      background:"#1e1a14", border:"1px solid #3a2e1e", borderRadius:6,
      padding:"7px 10px", color:"#e8d9b0", fontSize:13, fontFamily:"inherit",
      width:"100%",
    },
    btn: {
      background:"#C9A84C", color:"#1a1200", border:"none", borderRadius:6,
      padding:"8px 16px", fontSize:13, fontWeight:700, cursor:"pointer",
    },
    btnSm: {
      background:"#1e1a14", color:"#a89060", border:"1px solid #3a2e1e", borderRadius:6,
      padding:"5px 10px", fontSize:12, cursor:"pointer", fontFamily:"inherit",
    },
    btnDanger: {
      background:"#2a1111", color:"#ee5555", border:"1px solid #8b2222", borderRadius:6,
      padding:"5px 10px", fontSize:12, cursor:"pointer",
    },
    row: { display:"flex", gap:12, marginBottom:12 },
    col: { flex:1 },
  };

  return (
    <div style={cStyle.overlay}>
      {/* Header */}
      <div style={cStyle.header}>
        <span style={cStyle.title}>♩ ScoreSync Composer</span>
        {["setup","score","drums","piano"].map(t => (
          <button key={t} style={{...cStyle.tab, ...(composerTab===t ? cStyle.tabActive : {})}}
            onClick={() => setComposerTab(t)}>
            {t === "setup" ? "Project" : t === "score" ? "Score Builder" : t === "drums" ? "Drum Machine" : "Piano Roll"}
          </button>
        ))}
        <button style={{...cStyle.btnSm, marginLeft:"auto"}} onClick={onClose}>✕ Close</button>
      </div>

      {error && (
        <div style={{background:"#2a1111", color:"#ffb3b3", padding:"8px 20px", fontSize:13, display:"flex", justifyContent:"space-between"}}>
          {error}
          <button style={{background:"none",border:"none",color:"#ffb3b3",cursor:"pointer"}} onClick={() => setError("")}>✕</button>
        </div>
      )}
      {saveStatus && (
        <div style={{background:"#1a2a1a", color:"#6aaa6a", padding:"6px 20px", fontSize:12}}>
          ✓ {saveStatus}
        </div>
      )}

      <div style={cStyle.body}>

        {/* ── Setup / Project tab ── */}
        {composerTab === "setup" && (
          <>
            <div style={cStyle.card}>
              <div style={{fontSize:14, color:"#C9A84C", fontWeight:700, marginBottom:14}}>✕ New Composition</div>
              <div style={cStyle.row}>
                <div style={cStyle.col}>
                  <label style={cStyle.label}>Title</label>
                  <input style={cStyle.input} value={setupForm.title}
                    onChange={e => setSetupForm(f => ({...f, title: e.target.value}))} />
                </div>
                <div style={cStyle.col}>
                  <label style={cStyle.label}>Key</label>
                  <select style={cStyle.select} value={setupForm.key}
                    onChange={e => setSetupForm(f => ({...f, key: e.target.value}))}>
                    {KEYS.map(k => <option key={k}>{k}</option>)}
                  </select>
                </div>
                <div style={cStyle.col}>
                  <label style={cStyle.label}>Mode</label>
                  <select style={cStyle.select} value={setupForm.mode}
                    onChange={e => setSetupForm(f => ({...f, mode: e.target.value}))}>
                    {MODES.map(m => <option key={m}>{m}</option>)}
                  </select>
                </div>
              </div>
              <div style={cStyle.row}>
                <div style={cStyle.col}>
                  <label style={cStyle.label}>Tempo (BPM)</label>
                  <input style={cStyle.input} type="number" min="40" max="240" value={setupForm.tempo}
                    onChange={e => setSetupForm(f => ({...f, tempo: parseInt(e.target.value)||120}))} />
                </div>
                <div style={cStyle.col}>
                  <label style={cStyle.label}>Time Signature</label>
                  <select style={cStyle.select} value={setupForm.time_signature}
                    onChange={e => setSetupForm(f => ({...f, time_signature: e.target.value}))}>
                    {["4/4","3/4","2/4","6/8","5/4","7/8"].map(t => <option key={t}>{t}</option>)}
                  </select>
                </div>
                <div style={cStyle.col}>
                  <label style={cStyle.label}>Measures</label>
                  <input style={cStyle.input} type="number" min="1" max="64" value={setupForm.measures}
                    onChange={e => setSetupForm(f => ({...f, measures: parseInt(e.target.value)||8}))} />
                </div>
              </div>
              <div style={{marginBottom:14}}>
                <label style={cStyle.label}>Parts to include</label>
                <div style={{display:"flex", gap:8, flexWrap:"wrap"}}>
                  {PART_ROLES.map(role => (
                    <button key={role.id}
                      style={{...cStyle.btnSm,
                        ...(selectedParts.includes(role.id)
                          ? {background:role.color+"22", border:`1px solid ${role.color}`, color:role.color}
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

            {/* Saved compositions */}
            {compositions.length > 0 && (
              <div style={cStyle.card}>
                <div style={{fontSize:14, color:"#C9A84C", fontWeight:700, marginBottom:12}}>Saved Compositions</div>
                {compositions.map(comp => (
                  <div key={comp.id} style={{display:"flex", alignItems:"center", gap:10,
                    padding:"8px 0", borderBottom:"1px solid #1e1810"}}>
                    <div style={{flex:1}}>
                      <div style={{color:"#e8d9b0", fontSize:13, fontWeight:700}}>{comp.title}</div>
                      <div style={{color:"#665040", fontSize:11}}>{comp.key} {comp.mode} • {comp.tempo}bpm • {comp.measures}m</div>
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
          <>
            {!activeComp ? (
              <div style={{color:"#554030", textAlign:"center", padding:40}}>
                Create or open a composition in the Project tab.
              </div>
            ) : (
              <>
                <div style={{...cStyle.card, display:"flex", alignItems:"center", gap:16, flexWrap:"wrap"}}>
                  <div>
                    <div style={{fontSize:15, color:"#C9A84C", fontWeight:700}}>{activeComp.title}</div>
                    <div style={{fontSize:12, color:"#665040"}}>{activeComp.key} {activeComp.mode} • {activeComp.tempo} bpm • {activeComp.time_signature} • {activeComp.measures} measures</div>
                  </div>
                  <div style={{marginLeft:"auto", display:"flex", gap:8}}>
                    <button
                      style={{...cStyle.btn, fontSize:12, padding:"6px 16px",
                        background: isPlaying ? "#aa3333" : "#C9A84C",
                        color: isPlaying ? "#fff" : "#1a1200"}}
                      onClick={() => window.__playComposition(activeComp, setIsPlaying)}>
                      {isPlaying ? "⏹ Stop" : "▶ Play"}
                    </button>
                    <button style={cStyle.btnSm} onClick={exportXml}>Export MusicXML</button>
                  </div>
                </div>

                {/* Part rows */}
                {PART_ROLES.filter(r => selectedParts.includes(r.id)).map(role => {
                  const part = activeComp.parts.find(p => p.role === role.id);
                  return (
                    <div key={role.id} style={{...cStyle.card, borderLeft:`3px solid ${role.color}`}}>
                      <div style={{display:"flex", alignItems:"center", gap:10, marginBottom:10}}>
                        <span style={{fontSize:13, color:role.color, fontWeight:700}}>{role.label}</span>
                        <span style={{fontSize:11, color:"#554030"}}>
                          {part ? `${part.notes.length} notes` : "No notes yet"}
                        </span>
                        <div style={{marginLeft:"auto", display:"flex", gap:6}}>
                          <button style={cStyle.btnSm}
                            disabled={generatingPart === role.id}
                            onClick={() => generatePart(role.id)}>
                            {generatingPart === role.id ? "Generating..." : "✨ AI Generate"}
                          </button>
                          {part && (
                            <button style={{...cStyle.btnSm, color:"#7ec8e3"}}
                              onClick={() => { setPianoRollPart(role.id); setComposerTab("piano"); }}>
                              Piano Roll
                            </button>
                          )}
                        </div>
                      </div>
                      {/* Inline score preview — simple note strip */}
                      {part && part.notes.length > 0 ? (
                        <ScoreStrip notes={part.notes} color={role.color}
                          measures={activeComp.measures} />
                      ) : (
                        <div style={{fontSize:11, color:"#3a2e18", padding:"8px 0"}}>
                          Use AI Generate, or switch to Piano Roll to draw notes.
                        </div>
                      )}
                    </div>
                  );
                })}
              </>
            )}
          </>
        )}

        {/* ── Drum Machine tab ── */}
        {composerTab === "drums" && (
          <>
            <div style={{...cStyle.card, display:"flex", alignItems:"center", gap:12, flexWrap:"wrap"}}>
              <span style={{color:"#C9A84C", fontSize:14, fontWeight:700}}>Drum Machine</span>
              <span style={{color:"#665040", fontSize:12}}>Click pads to toggle • 16th-note resolution</span>
              <div style={{marginLeft:"auto", display:"flex", gap:8}}>
                <button style={cStyle.btnSm} disabled={generatingPart==="drums"}
                  onClick={generateDrums}>
                  {generatingPart==="drums" ? "Generating..." : "✨ AI Suggest"}
                </button>
                <button style={{...cStyle.btn, fontSize:12, padding:"6px 14px"}}
                  onClick={saveDrumPattern}>
                  Save to Project
                </button>
              </div>
            </div>

            <div style={{...cStyle.card, overflowX:"auto"}}>
              {/* Step numbers */}
              <div style={{display:"flex", marginBottom:6, marginLeft:80}}>
                {Array.from({length: drumSteps}).map((_,i) => (
                  <div key={i} style={{
                    width:30, textAlign:"center", fontSize:10,
                    color: i % 4 === 0 ? "#C9A84C" : "#3a2e18",
                    fontFamily:"monospace", flexShrink:0,
                  }}>{i+1}</div>
                ))}
              </div>
              {DRUM_ROWS.map(row => (
                <div key={row.id} style={{display:"flex", alignItems:"center", marginBottom:4}}>
                  <div style={{width:76, fontSize:12, color:row.color, textAlign:"right", paddingRight:4, flexShrink:0}}>
                    {row.label}
                  </div>
                  {Array.from({length: drumSteps}).map((_, step) => {
                    const on = drumPattern[row.id]?.[step] === 1;
                    const groupStart = step % 4 === 0;
                    return (
                      <div key={step}
                        onClick={() => toggleDrum(row.id, step)}
                        style={{
                          width:26, height:26, margin:"0 2px", borderRadius:4,
                          cursor:"pointer", flexShrink:0,
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
            <div style={{...cStyle.card, display:"flex", alignItems:"center", gap:12, flexWrap:"wrap"}}>
              <span style={{color:"#C9A84C", fontSize:14, fontWeight:700}}>Piano Roll</span>
              <select style={{...cStyle.select, width:180}} value={pianoRollPart}
                onChange={e => {
                  setPianoRollPart(e.target.value);
                  const pr = activeComp?.piano_rolls?.find(r => r.part_role === e.target.value);
                  setPianoRollCells(pr ? pr.cells : []);
                }}>
                {PART_ROLES.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}
              </select>
              <button style={{...cStyle.btnSm, ...(pianoEraseMode ? {background:"#2a1111", color:"#ee5555", border:"1px solid #8b2222"} : {})}}
                onClick={() => setPianoEraseMode(v => !v)}>
                {pianoEraseMode ? "🗑 Erase ON" : "✏ Draw"}
              </button>
              <button style={cStyle.btnSm} onClick={() => setPianoRollCells([])}>
                Clear
              </button>
              <button style={{...cStyle.btn, fontSize:12, padding:"6px 14px", marginLeft:"auto"}}
                onClick={savePianoRoll}>
                Save to Project
              </button>
            </div>

            {/* Piano roll grid */}
            <div style={{...cStyle.card, overflowX:"auto", overflowY:"auto", maxHeight:"calc(100vh - 260px)"}}>
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

// ─────────────────────────────────────────────────────────────────────────────
// ScoreStrip — lightweight horizontal note strip inside the score builder
// ─────────────────────────────────────────────────────────────────────────────
function ScoreStrip({ notes, color, measures }) {
  const NOTE_NAMES = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];
  const totalBeats = measures * 4;
  const W = 600, H = 60;
  // Get pitch range
  const midis = notes.map(n => n.pitch_midi || 60);
  const lo = Math.min(...midis, 48);
  const hi = Math.max(...midis, 84);
  const range = hi - lo || 12;

  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{display:"block",overflow:"visible"}}>
      <rect width={W} height={H} fill="#1a1610" rx="4"/>
      {/* measure lines */}
      {Array.from({length: measures + 1}).map((_, i) => (
        <line key={i} x1={i * W / measures} y1={0} x2={i * W / measures} y2={H}
          stroke={i % 4 === 0 ? "#3a2e18" : "#252015"} strokeWidth={i % 4 === 0 ? 1 : 0.5}/>
      ))}
      {/* notes */}
      {notes.map((n, i) => {
        const x = ((n.measure - 1 + (n.beat - 1) / 4) / measures) * W;
        const w = Math.max(4, (n.duration / (measures * 4)) * W);
        const midi = n.pitch_midi || 60;
        const y = H - ((midi - lo) / range) * (H - 8) - 6;
        return (
          <rect key={i} x={x} y={y} width={w - 1} height={5} rx={2}
            fill={color} opacity={0.85}/>
        );
      })}
    </svg>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PianoRollGrid — interactive grid with keyboard on the left
// ─────────────────────────────────────────────────────────────────────────────
function PianoRollGrid({ midiLow, midiHigh, beats16, cells, eraseMode, onCellInteract }) {
  const CELL_W = 22;
  const CELL_H = 14;
  const KEY_W  = 52;
  const totalRows = midiHigh - midiLow + 1;

  const NOTE_NAMES = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];
  const isBlack = midi => [1,3,6,8,10].includes(midi % 12);

  const isActive = (midi, b16) => cells.some(c => c.pitch_midi === midi && c.beat_16th === b16);

  const handlePointerDown = (midi, b16, e) => {
    e.preventDefault();
    onCellInteract(midi, b16);
  };

  const handlePointerEnter = (midi, b16, e) => {
    if (e.buttons === 1) onCellInteract(midi, b16);
  };

  const gridWidth  = beats16 * CELL_W;
  const gridHeight = totalRows * CELL_H;

  return (
    <div style={{display:"flex", userSelect:"none"}}>
      {/* Piano keyboard */}
      <div style={{width:KEY_W, flexShrink:0, position:"sticky", left:0, zIndex:10, background:"#181410"}}>
        {Array.from({length: totalRows}).map((_, i) => {
          const midi = midiHigh - i;
          const black = isBlack(midi);
          const noteName = NOTE_NAMES[midi % 12];
          const isC = midi % 12 === 0;
          return (
            <div key={midi} style={{
              height:CELL_H, display:"flex", alignItems:"center", justifyContent:"flex-end",
              paddingRight:4,
              background: black ? "#2a2020" : isC ? "#1e1a14" : "#181410",
              borderBottom: isC ? "1px solid #3a2e18" : "1px solid #221a14",
              color: black ? "#554030" : isC ? "#C9A84C" : "#5a4030",
              fontSize:9, fontFamily:"monospace",
            }}>
              {(isC || noteName.length === 2) ? noteName + (Math.floor(midi/12)-1) : ""}
            </div>
          );
        })}
      </div>

      {/* Grid */}
      <div style={{overflowX:"auto"}}>
        <div style={{width:gridWidth, position:"relative"}}>
          {Array.from({length: totalRows}).map((_, i) => {
            const midi = midiHigh - i;
            const black = isBlack(midi);
            const isC = midi % 12 === 0;
            return (
              <div key={midi} style={{display:"flex", height:CELL_H,
                borderBottom: isC ? "1px solid #3a2e18" : "1px solid #1e1810",
                background: black ? "#171410" : "#1a1610",
              }}>
                {Array.from({length: beats16}).map((_, b) => {
                  const on = isActive(midi, b);
                  const beatStart = b % 16 === 0;
                  const groupStart = b % 4 === 0;
                  return (
                    <div key={b}
                      onPointerDown={e => handlePointerDown(midi, b, e)}
                      onPointerEnter={e => handlePointerEnter(midi, b, e)}
                      style={{
                        width:CELL_W - 1, height:"100%", flexShrink:0,
                        marginRight:1,
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
          {/* Measure numbers overlay */}
          <div style={{position:"absolute", top:0, left:0, pointerEvents:"none", display:"flex"}}>
            {Array.from({length: Math.ceil(beats16 / 16)}).map((_, m) => (
              <div key={m} style={{width:16*CELL_W, fontSize:9, color:"#C9A84C",
                paddingLeft:2, opacity:0.6, flexShrink:0}}>
                M{m+1}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

//  Styles

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
  errorBanner: {
    background:"#351616", color:"#ffb3b3", padding:"10px 16px", display:"flex",
    alignItems:"center", justifyContent:"space-between", gap:12, fontSize:13, zIndex:99,
  },
  errorDismiss: {
    background:"transparent", border:"1px solid #8b4444", color:"#ffb3b3", borderRadius:6,
    padding:"4px 8px", cursor:"pointer", fontSize:12,
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
  stickyNoteInput: {
    fontSize:11, color:"#1a1200", lineHeight:1.3, wordWrap:"break-word",
    background:"transparent", border:"none", outline:"none", width:"100%",
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
  restAlertBanner: {
    padding:"10px 16px", borderRadius:8, marginBottom:12, border:"1px solid #3a2e18",
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// TRANSPOSITIONS — full instrument list (concert → written, semitones)
// ─────────────────────────────────────────────────────────────────────────────
const TRANSPOSITIONS = {
  // ─ Concert (C) instruments ─────────────────────────────────────────────
  "Concert (C)":          0,
  "Piccolo":              12,   // sounds an octave higher, written an octave lower
  "Flute":                0,
  "Alto Flute":          -5,   // in G: written 5 st above concert
  "Oboe":                 0,
  "English Horn":        -7,   // in F: written a P5 above concert
  "Bassoon":              0,
  "Contrabassoon":        0,   // sounds an octave lower, written concert
  "Piano":                0,
  "Organ":                0,
  "Harp":                 0,
  "Harpsichord":          0,
  "Celesta":             12,   // sounds an octave higher
  "Xylophone":           12,
  "Marimba":              0,
  "Vibraphone":           0,
  "Glockenspiel":        24,   // sounds two octaves higher
  "Violin":               0,
  "Viola":                0,
  "Cello":                0,
  "Double Bass":          0,   // sounds an octave lower, written concert
  "Guitar":               0,   // sounds an octave lower, written concert
  "Bass Guitar":          0,
  // ─ Bb instruments ─────────────────────────────────────────────────────
  "Bb Trumpet":           2,
  "Bb Cornet":            2,
  "Flugelhorn":           2,   // in Bb
  "Bb Clarinet":          2,
  "Bb Bass Clarinet":    14,   // written M9 above concert
  "Bass Clarinet (Bb)":  14,
  "Bb Soprano Sax":       2,
  "Bb Tenor Sax":        14,
  "Soprano Recorder":     0,
  // ─ Eb instruments ─────────────────────────────────────────────────────
  "Eb Trumpet":          -3,
  "Eb Alto Sax":          3,   // written M6 above concert  (concert = written - 3)
  "Eb Baritone Sax":    -9,   // written M6+octave above concert
  "Eb Clarinet":          3,
  // ─ F instruments ───────────────────────────────────────────────────────
  "F Horn":               7,   // written P5 above concert
  "French Horn":          7,
  "Mellophone":           7,
  // ─ Low brass / Concert pitch brass ───────────────────────────────
  "Trombone":             0,
  "Bass Trombone":        0,
  "Alto Trombone":        0,
  "Tenor Trombone":       0,
  "Euphonium":            0,
  "Euphonium (Treble)": -14,  // treble-clef Bb euphonium parts are written a M9 up
  "Baritone (Treble)":  -14,
  "Tuba":                 0,
  "Contrabass Tuba":      0,
  "Sousaphone":           0,
  // ─ Marching / Miscellaneous ─────────────────────────────────────
  "Bugle":                2,
  "Drum Kit":             0,
  "Mallet Percussion":    0,
  "Timpani":              0,
  "Snare Drum":           0,
};

// ─────────────────────────────────────────────────────────────────────────────
// Composer Web Audio playback engine (no server, no paid API)
// ─────────────────────────────────────────────────────────────────────────────

// Instrument voice presets — oscillator type + envelope + optional detune
const INSTRUMENT_VOICE = {
  default:          { type: "sine",     attack: 0.02, decay: 0.1,  sustain: 0.7, release: 0.3,  gain: 0.4 },
  Piano:            { type: "triangle", attack: 0.01, decay: 0.4,  sustain: 0.3, release: 0.8,  gain: 0.5 },
  Flute:            { type: "sine",     attack: 0.06, decay: 0.05, sustain: 0.8, release: 0.2,  gain: 0.35 },
  Oboe:             { type: "sawtooth", attack: 0.04, decay: 0.1,  sustain: 0.7, release: 0.15, gain: 0.25 },
  "English Horn":   { type: "sawtooth", attack: 0.05, decay: 0.12, sustain: 0.65,release: 0.2,  gain: 0.28 },
  Bassoon:          { type: "sawtooth", attack: 0.04, decay: 0.15, sustain: 0.6, release: 0.25, gain: 0.3 },
  Clarinet:         { type: "square",   attack: 0.03, decay: 0.08, sustain: 0.75,release: 0.15, gain: 0.2 },
  Trumpet:          { type: "sawtooth", attack: 0.02, decay: 0.05, sustain: 0.85,release: 0.1,  gain: 0.35 },
  Flugelhorn:       { type: "sine",     attack: 0.04, decay: 0.08, sustain: 0.75,release: 0.2,  gain: 0.32 },
  Horn:             { type: "sine",     attack: 0.06, decay: 0.1,  sustain: 0.8, release: 0.3,  gain: 0.3 },
  Trombone:         { type: "sawtooth", attack: 0.04, decay: 0.1,  sustain: 0.8, release: 0.25, gain: 0.32 },
  "Bass Trombone":  { type: "sawtooth", attack: 0.05, decay: 0.12, sustain: 0.8, release: 0.3,  gain: 0.35 },
  Euphonium:        { type: "sine",     attack: 0.05, decay: 0.1,  sustain: 0.8, release: 0.3,  gain: 0.35 },
  Tuba:             { type: "sine",     attack: 0.06, decay: 0.15, sustain: 0.75,release: 0.4,  gain: 0.4 },
  Violin:           { type: "sawtooth", attack: 0.05, decay: 0.05, sustain: 0.9, release: 0.2,  gain: 0.3 },
  Viola:            { type: "sawtooth", attack: 0.06, decay: 0.06, sustain: 0.88,release: 0.25, gain: 0.3 },
  Cello:            { type: "sawtooth", attack: 0.07, decay: 0.08, sustain: 0.85,release: 0.3,  gain: 0.35 },
};

function midiToHz(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

function _voiceForInstrument(name) {
  for (const key of Object.keys(INSTRUMENT_VOICE)) {
    if (name && name.toLowerCase().includes(key.toLowerCase())) return INSTRUMENT_VOICE[key];
  }
  return INSTRUMENT_VOICE.default;
}

/**
 * playCompositionPreview — renders the full composition using Web Audio API.
 * Returns a stop() function that cancels all scheduled nodes.
 */
function playCompositionPreview(comp, onEnd) {
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) { onEnd && onEnd(); return () => {}; }

  const ctx = new AudioCtx();
  const masterGain = ctx.createGain();
  masterGain.gain.value = 0.8;
  masterGain.connect(ctx.destination);

  const beatsPerMeasure = parseInt((comp.time_signature || "4/4").split("/")[0]);
  const secPerBeat = 60 / (comp.tempo || 120);
  const scheduledNodes = [];

  function scheduleNote(midi, startBeat, durBeats, voicePreset) {
    const freq = midiToHz(midi);
    const startTime = ctx.currentTime + startBeat * secPerBeat;
    const durSec = durBeats * secPerBeat;
    const v = voicePreset;

    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    osc.type = v.type;
    osc.frequency.value = freq;

    // ADSR envelope
    env.gain.setValueAtTime(0, startTime);
    env.gain.linearRampToValueAtTime(v.gain, startTime + v.attack);
    env.gain.linearRampToValueAtTime(v.gain * v.sustain, startTime + v.attack + v.decay);
    env.gain.setValueAtTime(v.gain * v.sustain, startTime + durSec - v.release);
    env.gain.linearRampToValueAtTime(0, startTime + durSec);

    osc.connect(env);
    env.connect(masterGain);
    osc.start(startTime);
    osc.stop(startTime + durSec + 0.05);
    scheduledNodes.push(osc);
  }

  let totalBeats = 0;

  // Schedule melodic parts
  (comp.parts || []).forEach(part => {
    const voice = _voiceForInstrument(part.instrument || part.role);
    (part.notes || []).forEach(n => {
      const globalBeat = (n.measure - 1) * beatsPerMeasure + (n.beat - 1);
      scheduleNote(n.pitch_midi || 60, globalBeat, n.duration || 1, voice);
      totalBeats = Math.max(totalBeats, globalBeat + (n.duration || 1));
    });
  });

  // Schedule drum pattern as a repeating loop over all measures
  if (comp.drum_pattern) {
    const pat = comp.drum_pattern.pattern || {};
    const steps = comp.drum_pattern.steps || 16;
    const secPerStep = secPerBeat / 4; // 16th note
    const DRUM_MIDI = { kick:36, snare:38, hihat:42, open_hat:46, crash:49, tom:45 };
    const totalSteps = comp.measures * steps;
    Object.entries(pat).forEach(([rowId, arr]) => {
      const midiNote = DRUM_MIDI[rowId] || 38;
      for (let step = 0; step < totalSteps; step++) {
        if (arr[step % arr.length] !== 1) continue;
        const startTime = ctx.currentTime + step * secPerStep;
        // Synthesise percussive hit
        const osc = ctx.createOscillator();
        const env = ctx.createGain();
        const baseFreq = rowId === "kick" ? 80 : rowId === "snare" ? 200 : rowId.includes("hat") ? 8000 : 300;
        osc.frequency.setValueAtTime(baseFreq, startTime);
        if (rowId === "kick") osc.frequency.exponentialRampToValueAtTime(40, startTime + 0.08);
        osc.type = (rowId.includes("hat") || rowId === "crash") ? "square" : "sine";
        env.gain.setValueAtTime(0.5, startTime);
        env.gain.exponentialRampToValueAtTime(0.001, startTime + (rowId.includes("hat") ? 0.04 : 0.12));
        osc.connect(env);
        env.connect(masterGain);
        osc.start(startTime);
        osc.stop(startTime + 0.2);
        scheduledNodes.push(osc);
      }
    });
  }

  // Schedule piano roll cells
  (comp.piano_rolls || []).forEach(roll => {
    const voice = _voiceForInstrument("Piano");
    (roll.cells || []).forEach(c => {
      const globalBeat = c.beat_16th / 4;
      scheduleNote(c.pitch_midi || 60, globalBeat, (c.duration_16th || 1) / 4, voice);
      totalBeats = Math.max(totalBeats, globalBeat + (c.duration_16th || 1) / 4);
    });
  });

  // Fire onEnd callback
  const endTimeout = setTimeout(() => {
    ctx.close();
    onEnd && onEnd();
  }, (totalBeats * secPerBeat + 1) * 1000);

  return function stop() {
    clearTimeout(endTimeout);
    scheduledNodes.forEach(n => { try { n.stop(); } catch(_) {} });
    ctx.close();
    onEnd && onEnd();
  };
}

// Patch ComposerOverlay to add playback — we attach playback state to the
// existing ComposerOverlay by re-exporting a wrapped version that wires
// the playback button in the Score Builder header. Since the component is
// defined above and JSX is compiled top-down, we add the playback helpers
// here and rely on the Score Builder header button calling these globals.
// The actual button is injected via the patch below.
window.__composerPlayback = null;
window.__playComposition = function(comp, setPlaying) {
  if (window.__composerPlayback) { window.__composerPlayback(); window.__composerPlayback = null; setPlaying(false); return; }
  const stop = playCompositionPreview(comp, () => { window.__composerPlayback = null; setPlaying(false); });
  window.__composerPlayback = stop;
  setPlaying(true);
};

// ─────────────────────────────────────────────────────────────────────────────
// Music scale data
// ─────────────────────────────────────────────────────────────────────────────

const NOTE_NAMES = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];

const MAJOR_SCALES = [
  { name:"C Major",  notes:[0,2,4,5,7,9,11,12] },
  { name:"G Major",  notes:[7,9,11,0,2,4,6,7] },
  { name:"D Major",  notes:[2,4,6,7,9,11,1,2] },
  { name:"F Major",  notes:[5,7,9,10,0,2,4,5] },
  { name:"Bb Major", notes:[10,0,2,3,5,7,9,10] },
];

const MEYER_SCALES = [
  { name:"Meyer V1", notes:[0,2,4,5,7,9,11,12] },
  { name:"Meyer V2", notes:[0,2,3,5,7,9,10,12] },
  { name:"Meyer V3", notes:[0,2,4,6,7,9,11,12] },
];

// ─────────────────────────────────────────────────────────────────────────────
// Pitch detection utilities
// ─────────────────────────────────────────────────────────────────────────────

function yin(buffer, sampleRate) {
  const threshold = 0.12;
  const N = buffer.length;
  const halfN = Math.floor(N / 2);
  const yinBuffer = new Float32Array(halfN);

  // Step 1: autocorrelation difference
  yinBuffer[0] = 1;
  let runningSum = 0;
  for (let tau = 1; tau < halfN; tau++) {
    let delta = 0;
    for (let i = 0; i < halfN; i++) {
      const d = buffer[i] - buffer[i + tau];
      delta += d * d;
    }
    runningSum += delta;
    yinBuffer[tau] = runningSum === 0 ? 0 : (delta * tau) / runningSum;
  }

  // Step 2: find first dip below threshold
  let tau = 2;
  while (tau < halfN) {
    if (yinBuffer[tau] < threshold) {
      while (tau + 1 < halfN && yinBuffer[tau + 1] < yinBuffer[tau]) tau++;
      // Parabolic interpolation
      const better = tau + 0.5 * (yinBuffer[tau - 1] - yinBuffer[tau + 1]) /
        (yinBuffer[tau - 1] - 2 * yinBuffer[tau] + yinBuffer[tau + 1] || 1e-10);
      return sampleRate / better;
    }
    tau++;
  }
  return 0;
}

function freqToMidi(freq) {
  return Math.round(12 * Math.log2(freq / 440) + 69);
}

function midiToNoteName(midi) {
  return NOTE_NAMES[((midi % 12) + 12) % 12];
}

function freqToNoteLabel(freq) {
  const midi = freqToMidi(freq);
  const octave = Math.floor(midi / 12) - 1;
  return midiToNoteName(midi) + octave;
}

function centsDiff(freq, midi) {
  const idealFreq = 440 * Math.pow(2, (midi - 69) / 12);
  return 1200 * Math.log2(freq / idealFreq);
}

function computeRMS(buffer) {
  let sum = 0;
  for (let i = 0; i < buffer.length; i++) sum += buffer[i] * buffer[i];
  return Math.sqrt(sum / buffer.length);
}

function computeSpectralCentroid(spectrum, sampleRate) {
  let weightedSum = 0, totalPower = 0;
  const binWidth = sampleRate / (2 * spectrum.length);
  for (let i = 0; i < spectrum.length; i++) {
    const power = Math.pow(10, spectrum[i] / 10);
    weightedSum += power * i * binWidth;
    totalPower += power;
  }
  return totalPower > 0 ? weightedSum / totalPower : 0;
}

function computeSpectralFlatness(spectrum) {
  let logSum = 0, sum = 0;
  const powers = spectrum.map(db => Math.pow(10, db / 10));
  powers.forEach(p => { logSum += Math.log(p + 1e-10); sum += p; });
  const geoMean = Math.exp(logSum / powers.length);
  const arithMean = sum / powers.length;
  return arithMean > 0 ? geoMean / arithMean : 0;
}

function detectVibratoFromHistory(freqHistory, sampleRate) {
  if (freqHistory.length < 16) return { rate: 0, depth: 0 };
  const recent = freqHistory.slice(-32);
  const mean = recent.reduce((a, b) => a + b, 0) / recent.length;
  const deviations = recent.map(f => f - mean);
  // Count zero crossings to estimate vibrato rate
  let crossings = 0;
  for (let i = 1; i < deviations.length; i++) {
    if (deviations[i - 1] * deviations[i] < 0) crossings++;
  }
  const rate = crossings / 2; // rough Hz
  const depth = Math.max(...deviations.map(Math.abs));
  return { rate, depth };
}

// ─────────────────────────────────────────────────────────────────────────────
// Score analysis utilities
// ─────────────────────────────────────────────────────────────────────────────

function analyzeMarkings(xmlText) {
  const markingTypes = [
    { tag: "dynamics",  label: "Dynamics" },
    { tag: "wedge",     label: "Crescendo/Decrescendo" },
    { tag: "fermata",   label: "Fermata" },
    { tag: "accent",    label: "Accent" },
    { tag: "staccato",  label: "Staccato" },
    { tag: "tenuto",    label: "Tenuto" },
    { tag: "trill",     label: "Trill" },
    { tag: "slur",      label: "Slur" },
    { tag: "tie",       label: "Tie" },
    { tag: "rest",      label: "Rest" },
    { tag: "pedal",     label: "Pedal" },
    { tag: "rehearsal", label: "Rehearsal Mark" },
    { tag: "segno",     label: "Segno" },
    { tag: "coda",      label: "Coda" },
    { tag: "damp",      label: "Damp" },
  ];

  const dynamicValues = ["pppp","ppp","pp","p","mp","mf","f","ff","fff","ffff","sf","sfz","rfz","fz","fp","pf","n"];
  const results = [];

  markingTypes.forEach(({ tag, label }) => {
    const regex = new RegExp(`<${tag}[\\s/>]`, 'g');
    const matches = xmlText.match(regex);
    if (matches && matches.length) {
      results.push({ type: label, count: matches.length, detail: `Found in score` });
    }
  });

  // Dynamic markings
  const dynCount = {};
  dynamicValues.forEach(dyn => {
    const m = xmlText.match(new RegExp(`<${dyn}/>`, 'g'));
    if (m) dynCount[dyn] = m.length;
  });
  if (Object.keys(dynCount).length) {
    const detail = Object.entries(dynCount).map(([k,v]) => `${k}×${v}`).join(", ");
    results.push({ type: "Dynamic markings", count: Object.values(dynCount).reduce((a,b) => a+b, 0), detail });
  }

  return results;
}

function extractScoreNoteNames(xmlText) {
  const noteSet = new Set();
  const stepMatches = xmlText.match(/<step>([A-G])<\/step>/g) || [];
  stepMatches.forEach(m => {
    const s = m.match(/<step>([A-G])<\/step>/);
    if (s) noteSet.add(s[1]);
  });
  return Array.from(noteSet);
}

function extractRestAlerts(xmlText) {
  const alerts = [];
  const measureMatches = xmlText.match(/<measure[^>]*number="([^"]*)">([\s\S]*?)<\/measure>/g) || [];
  measureMatches.forEach(block => {
    const numMatch = block.match(/number="([^"]*)"/); 
    if (!numMatch) return;
    const measureNum = parseInt(numMatch[1]);
    if (block.includes("<rest")) {
      alerts.push({ measure: measureNum });
    }
  });
  return alerts;
}

function generateMarkingSuggestions(currentMeasure, rhythmInfo, complexMarkings, liveMetrics) {
  const suggestions = [];
  const upcoming = complexMarkings.filter(m => m.measure >= currentMeasure && m.measure <= currentMeasure + 2);

  upcoming.forEach(marking => {
    if (marking.type === "rest") {
      suggestions.push({ measure: marking.measure, suggestion: `Rest at measure ${marking.measure} — breathe and relax` });
    }
    if (marking.type === "articulation") {
      suggestions.push({ measure: marking.measure, suggestion: `Articulation at measure ${marking.measure} — note accent/staccato markings` });
    }
    if (marking.type === "fermata") {
      suggestions.push({ measure: marking.measure, suggestion: `Fermata at measure ${marking.measure} — hold until conductor cues` });
    }
  });

  if (liveMetrics) {
    if (liveMetrics.noteCharacter === "staccato" && upcoming.some(m => m.type !== "articulation")) {
      suggestions.push({ measure: currentMeasure, suggestion: "Detected staccato — upcoming notes may prefer legato" });
    }
    if (liveMetrics.hasVibrato && liveMetrics.vibratoStrength > 0.8) {
      suggestions.push({ measure: currentMeasure, suggestion: "Strong vibrato detected — check if desired here" });
    }
  }

  return suggestions;
}

// ─────────────────────────────────────────────────────────────────────────────
// Voice recognition helpers
// ─────────────────────────────────────────────────────────────────────────────

function startVoiceRecognition(onMeasureJump, onWakeWord) {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) return null;

  const recognition = new SpeechRecognition();
  recognition.continuous = true;
  recognition.interimResults = false;
  recognition.lang = "en-US";

  recognition.onresult = (event) => {
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const transcript = event.results[i][0].transcript.toLowerCase().trim();

      // Wake word: "measure [N]" or "go to [N]"
      const measureMatch = transcript.match(/(?:measure|go to|jump to)\s+(\d+)/);
      if (measureMatch) {
        const measureNum = parseInt(measureMatch[1]);
        if (!isNaN(measureNum)) {
          onMeasureJump(measureNum);
          return;
        }
      }

      // Wake phrase: "resume" or "take it from [N]"
      const resumeMatch = transcript.match(/(?:resume|take it from|start from)\s*(\d+)?/);
      if (resumeMatch) {
        const measureNum = resumeMatch[1] ? parseInt(resumeMatch[1]) : 1;
        onWakeWord(isNaN(measureNum) ? 1 : measureNum);
        return;
      }
    }
  };

  recognition.onerror = () => {};
  recognition.onend = () => { try { recognition.start(); } catch(_) {} };

  try { recognition.start(); } catch(_) {}
  return recognition;
}

