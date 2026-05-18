import { useState, useEffect, useRef, useCallback } from "react";
import { apiRequest, normalizeProfile, calibrationToRequest } from "./api.js";
import { styles } from "./styles.js";
import { TRANSPOSITIONS, NOTE_NAMES, MAJOR_SCALES, MEYER_SCALES, MIN_NOTE_STABILITY_MS } from "./constants.js";
import {
  yin, freqToMidi, midiToNoteName, freqToNoteLabel, centsDiff,
  computeRMS, computeSpectralCentroid, computeSpectralFlatness, detectVibratoFromHistory,
} from "./pitchUtils.js";
import {
  analyzeMarkings, extractScoreNoteNames, extractRestAlerts, generateMarkingSuggestions,
} from "./scoreUtils.js";
import { startVoiceRecognition } from "./voiceRecognition.js";
import ComposerOverlay from "./ComposerOverlay.jsx";
import "./audioPlayback.js"; // side-effect: wires window.__playComposition

// ─── Root App ─────────────────────────────────────────────────────────────────

export default function App() {
  const [screen, setScreen]         = useState("auth");
  const [user, setUser]             = useState(null);
  const [profile, setProfile]       = useState(null);
  const [authMode, setAuthMode]     = useState("login");
  const [authForm, setAuthForm]     = useState({ email: "", password: "", name: "" });
  const [authError, setAuthError]   = useState("");
  const [authLoading, setAuthLoading] = useState(true);
  const [authBusy, setAuthBusy]     = useState(false);

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
    if (!authForm.email || !authForm.password) {
      setAuthError("Email and password are required.");
      return;
    }
    setAuthError("");
    setAuthBusy(true);
    try {
      const payload = await apiRequest("/auth/login", {
        method: "POST",
        body: JSON.stringify({ email: authForm.email.trim(), password: authForm.password }),
      });
      const me = await apiRequest("/auth/me").catch(() => ({ ...payload, id: payload.user_id, profile: null }));
      setUser({ id: me.id || payload.user_id, email: me.email, name: me.name });
      setProfile(normalizeProfile(me.profile));
      setScreen("main");
    } catch (err) {
      setAuthError(err.message || "Sign in failed.");
    } finally {
      setAuthBusy(false);
    }
  }

  async function handleSignup() {
    if (!authForm.email || !authForm.password || !authForm.name) { setAuthError("All fields required."); return; }
    setAuthError("");
    setAuthBusy(true);
    try {
      const payload = await apiRequest("/auth/register", {
        method: "POST",
        body: JSON.stringify({
          email: authForm.email.trim(),
          password: authForm.password,
          name: authForm.name.trim(),
        }),
      });
      setUser({ id: payload.user_id, email: payload.email, name: payload.name });
      setProfile({ instrument: "Concert (C)", calibration: { skipped: true } });
      setScreen("instrument");
    } catch (err) {
      setAuthError(err.message || "Account creation failed.");
    } finally {
      setAuthBusy(false);
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
    if (payload.sessions.length) {
      await apiRequest("/profile/calibration", { method: "POST", body: JSON.stringify(payload) }).catch(() => null);
    }
    setProfile(prev => ({ ...prev, calibration: payload.sessions.length ? { saved: true } : { skipped: true } }));
    setScreen("main");
  }

  function handleSkipCalibration() {
    setProfile(prev => ({ ...prev, calibration: { skipped: true } }));
    setScreen("main");
  }

  if (authLoading) {
    return (
      <div style={styles.authBg}>
        <div style={styles.authCard}>
          <span style={styles.authBrand}>ScoreSync</span>
        </div>
      </div>
    );
  }

  if (screen === "auth") return (
    <AuthScreen mode={authMode} form={authForm} error={authError} busy={authBusy}
      onFormChange={f => setAuthForm(f)}
      onLogin={handleLogin}
      onSignup={handleSignup}
      onToggleMode={() => { setAuthMode(m => m === "login" ? "signup" : "login"); setAuthError(""); }}
    />
  );

  if (screen === "instrument") return (
    <InstrumentScreen onSave={handleInstrumentSave} />
  );

  if (screen === "calibrate") return (
    <CalibrationScreen
      instrument={profile.instrument}
      onDone={handleCalibrationDone}
      onSkip={handleSkipCalibration}
    />
  );

  return (
    <MainScreen
      user={user}
      profile={profile}
      onLogout={handleLogout}
      onRecalibrate={() => setScreen("calibrate")}
    />
  );
}

// ─── Auth Screen ──────────────────────────────────────────────────────────────

function AuthScreen({ mode, form, error, busy, onFormChange, onLogin, onSignup, onToggleMode }) {
  const isLogin = mode === "login";
  const submitLabel = busy ? (isLogin ? "Signing In..." : "Creating Account...") : (isLogin ? "Sign In" : "Create Account");
  return (
    <div style={styles.authBg}>
      <form style={styles.authCard} onSubmit={e => { e.preventDefault(); isLogin ? onLogin() : onSignup(); }}>
        <div style={styles.authLogo}>
          <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
            <circle cx="20" cy="20" r="20" fill="#C9A84C"/>
            <text x="20" y="26" textAnchor="middle" fontSize="18" fill="#1a1a1a" fontFamily="serif">S</text>
          </svg>
          <span style={styles.authBrand}>ScoreSync</span>
        </div>
        <h2 style={styles.authTitle}>{isLogin ? "Welcome back" : "Create account"}</h2>
        {!isLogin && (
          <input style={styles.authInput} placeholder="Display name" aria-label="Display name" autoComplete="name" disabled={busy}
            value={form.name} onChange={e => onFormChange({ ...form, name: e.target.value })} />
        )}
        <input style={styles.authInput} placeholder="Email" type="email" aria-label="Email" autoComplete="email" disabled={busy}
          value={form.email} onChange={e => onFormChange({ ...form, email: e.target.value })} />
        <input style={styles.authInput} placeholder="Password" type="password" aria-label="Password" autoComplete={isLogin ? "current-password" : "new-password"} disabled={busy}
          value={form.password} onChange={e => onFormChange({ ...form, password: e.target.value })} />
        {error && <div style={styles.authError} role="alert">{error}</div>}
        <button style={{ ...styles.authBtn, opacity: busy ? 0.7 : 1 }} type="submit" disabled={busy}>
          {submitLabel}
        </button>
        <button style={styles.authToggle} type="button" onClick={onToggleMode} disabled={busy}>
          {isLogin ? "Need an account? Sign up" : "Have an account? Sign in"}
        </button>
      </form>
    </div>
  );
}

// ─── Instrument Screen ────────────────────────────────────────────────────────

function InstrumentScreen({ onSave }) {
  const [selected, setSelected] = useState("Concert (C)");
  const instruments = Object.keys(TRANSPOSITIONS);
  return (
    <div style={styles.authBg}>
      <div style={{ ...styles.authCard, maxWidth: 520 }}>
        <div style={styles.authLogo}>
          <span style={styles.authBrand}>Select Your Instrument</span>
        </div>
        <p style={styles.instrNote}>
          ScoreSync will display all scales in <strong>concert pitch</strong>.
          For transposing instruments, parts will be transposed automatically on the backend.
        </p>
        <div style={styles.instrGrid}>
          {instruments.map(i => (
            <button key={i}
              style={{ ...styles.instrBtn, ...(selected === i ? styles.instrBtnActive : {}) }}
              onClick={() => setSelected(i)}>
              {i}
            </button>
          ))}
        </div>
        {TRANSPOSITIONS[selected] !== 0 && (
          <div style={styles.transpBadge}>
            ↕ Transposes {Math.abs(TRANSPOSITIONS[selected])} semitone{Math.abs(TRANSPOSITIONS[selected]) !== 1 ? "s" : ""}{" "}
            {TRANSPOSITIONS[selected] > 0 ? "up" : "down"} from concert
          </div>
        )}
        <button style={{ ...styles.authBtn, marginTop: 24 }} onClick={() => onSave(selected)}>
          Continue
        </button>
      </div>
    </div>
  );
}

// ─── Calibration Screen ───────────────────────────────────────────────────────

function CalibrationScreen({ instrument, onDone, onSkip }) {
  const ALL_SCALES = [...MAJOR_SCALES, ...MEYER_SCALES];
  const [step, setStep]                   = useState(0);
  const [isListening, setIsListening]     = useState(false);
  const [detectedNotes, setDetectedNotes] = useState([]);
  const [currentFreq, setCurrentFreq]     = useState(0);
  const [calibData, setCalibData]         = useState({});
  const [phase, setPhase]                 = useState("intro"); // intro | playing | done
  const audioCtxRef  = useRef(null);
  const analyserRef  = useRef(null);
  const sourceRef    = useRef(null);
  const rafRef       = useRef(null);
  const bufRef       = useRef(null);
  const streamRef    = useRef(null);

  const scale      = ALL_SCALES[step];
  const totalSteps = ALL_SCALES.length;

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
    } catch (e) {
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
          if (expected.includes(noteName) && (prev.length === 0 || prev[prev.length - 1] !== noteName)) {
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
      <div style={{ ...styles.authCard, maxWidth: 580 }}>
        {phase === "intro" ? (
          <>
            <div style={styles.authLogo}><span style={styles.authBrand}>Microphone Calibration</span></div>
            <p style={styles.instrNote}>
              Calibration is optional. You can play a few scales now, or skip and let ScoreSync learn your tuning tendencies during practice.
            </p>
            <p style={{ color:"#C9A84C", fontSize:13 }}>
              All scales displayed in <strong>concert pitch</strong>.
              {TRANSPOSITIONS[instrument] !== 0 && ` Your ${instrument} part will be transposed automatically.`}
            </p>
            <div style={{ display:"flex", gap:12, marginTop:20 }}>
              <button style={styles.authBtn} onClick={() => { setPhase("playing"); startMic(); }}>
                Start Calibration
              </button>
              <button style={{ ...styles.authToggle, border:"1px solid #444", borderRadius:8, padding:"10px 20px" }}
                onClick={onSkip}>
                Skip for now
              </button>
            </div>
          </>
        ) : (
          <>
            <div style={styles.calibHeader}>
              <span style={styles.calibScaleName}>{scale.name}</span>
              <span style={styles.calibProgress}>{step + 1} / {totalSteps}</span>
            </div>
            <div style={styles.progressBar}>
              <div style={{ ...styles.progressFill, width: `${progress}%` }}/>
            </div>
            <div style={styles.scaleDisplay}>
              {scale.notes.map((n, i) => {
                const noteName = NOTE_NAMES[n];
                const detected = detectedNotes.includes(noteName);
                return (
                  <div key={i} style={{ ...styles.scaleNote, ...(detected ? styles.scaleNoteHit : {}) }}>
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
                <span style={{ color:"#666" }}>Play the scale above ascending and descending</span>
              )}
            </div>
            <div style={{ display:"flex", gap:12, marginTop:20, justifyContent:"center" }}>
              {!isListening ? (
                <button style={styles.authBtn} onClick={startMic}>Start Listening</button>
              ) : (
                <>
                  <button style={{ ...styles.authBtn, background:"#2a5" }} onClick={handleSaveAndNext}>
                    Save & Next Scale
                  </button>
                  <button style={styles.authToggle} onClick={stopMic}>Stop Mic</button>
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
  const [score, setScore]                         = useState(null);
  const [scoreType, setScoreType]                 = useState(null);
  const [markings, setMarkings]                   = useState([]);
  const [complexMarkings, setComplexMarkings]     = useState([]);
  const [restAlerts, setRestAlerts]               = useState([]);
  const [rhythmInfo, setRhythmInfo]               = useState(null);
  const [isListening, setIsListening]             = useState(false);
  const [currentFreq, setCurrentFreq]             = useState(0);
  const [currentNote, setCurrentNote]             = useState(null);
  const [currentMidi, setCurrentMidi]             = useState(null);
  const [cents, setCents]                         = useState(0);
  const [autoScroll, setAutoScroll]               = useState(true);
  const [isAutoScrollPaused, setIsAutoScrollPaused] = useState(false);
  const [sidebarTab, setSidebarTab]               = useState("markings");
  const [showComposer, setShowComposer]           = useState(false);
  const [showProfile, setShowProfile]             = useState(false);
  const [tempoPrompt, setTempoPrompt]             = useState(false);
  const [currentRestAlert, setCurrentRestAlert]   = useState(null);
  const [trainingMode, setTrainingMode]           = useState(false);
  const [trainingSegments, setTrainingSegments]   = useState([]);
  const [scoreNoteNames, setScoreNoteNames]       = useState([]);
  const [loopMode, setLoopMode]                   = useState("none");
  const [osmdLoaded, setOsmdLoaded]               = useState(false);
  const [osmdError, setOsmdError]                 = useState(null);
  const [markingSuggestions, setMarkingSuggestions] = useState([]);
  const [stickyNotes, setStickyNotes]             = useState([]);
  const [currentMeasure, setCurrentMeasure]       = useState(1);
  const [wakeWordNotice, setWakeWordNotice]       = useState(null);
  const [voiceRecognitionActive, setVoiceRecognitionActive] = useState(false);
  const [stickyNoteMode, setStickyNoteMode]       = useState(false);
  const [errorMessage, setErrorMessage]           = useState(null);
  const [loadingSynthesis, setLoadingSynthesis]   = useState(false);
  const [loadingMetronome, setLoadingMetronome]   = useState(false);
  const [numberOfSegments, setNumberOfSegments]   = useState(4);

  const [noteHistory, setNoteHistory]             = useState([]);
  const [rmsLevel, setRmsLevel]                   = useState(0);
  const [spectralCentroid, setSpectralCentroid]   = useState(0);
  const [spectralFlatness, setSpectralFlatness]   = useState(0);
  const [attackMs, setAttackMs]                   = useState(0);
  const [releaseMs, setReleaseMs]                 = useState(0);
  const [vibratoStrength, setVibratoStrength]     = useState(0);
  const [performanceArticulation, setPerformanceArticulation] = useState("");

  const scoreContainerRef    = useRef(null);
  const wakeCountdownTimerRef = useRef(null);
  const audioCtxRef          = useRef(null);
  const analyserRef          = useRef(null);
  const streamRef            = useRef(null);
  const rafRef               = useRef(null);
  const bufRef               = useRef(null);
  const osmdRef              = useRef(null);
  const osmdContainerRef     = useRef(null);
  const noteHistoryRef       = useRef([]);
  const freqHistoryRef       = useRef([]);
  const lastRmsRef           = useRef(0);
  const noteStableSinceRef   = useRef(null);
  const previousNoteRef      = useRef(null);
  const frameCounterRef      = useRef(0);
  const audioElementRef      = useRef(null);

  const [settings, setSettings] = useState({
    stopAtWrongNote: true,
    loopOnWrongNote: false,
    pauseOnSilence: false,
    metronomeSource: "backend",
    metronomeEnabled: false,
    restAlertEnabled: true,
    restAlertAdvance: 1,
    markingSuggestionsEnabled: true,
    stickyNotesEnabled: true,
    voiceMeasureJumpEnabled: true,
    liveAnalysisEnabled: true,
  });

  const [metronomeState, setMetronomeState] = useState({ isPlaying: false, bpm: 120, intervalId: null });
  const metronomeActive = metronomeState.isPlaying;

  // ── OSMD loader ──────────────────────────────────────────────────────────
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
    } catch (e) {
      setOsmdError("Score render error: " + e.message);
    }
  }, [osmdLoaded, score, scoreType]);

  // ── Cursor helpers ────────────────────────────────────────────────────────
  const getOsmdMeasureIndex = useCallback(() => {
    const iterator = osmdRef.current?.cursor?.iterator;
    const raw = iterator?.CurrentMeasureIndex ?? iterator?.currentMeasureIndex;
    return Number.isFinite(raw) ? raw : currentMeasure - 1;
  }, [currentMeasure]);

  const scrollToOsmdCursor = useCallback(() => {
    const container = scoreContainerRef.current;
    const cursorElement = osmdRef.current?.cursor?.cursorElement;
    if (!container || !cursorElement) return false;
    const top = cursorElement.offsetTop ||
      cursorElement.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop;
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

  // ── File loader ──────────────────────────────────────────────────────────
  async function handleFileLoad(e) {
    const file = e.target.files[0];
    if (!file) return;
    setOsmdError(null);
    const ext = file.name.split(".").pop().toLowerCase();

    if (ext === "pdf") {
      setScore(URL.createObjectURL(file));
      setScoreType("pdf");
      setMarkings([]);
    } else if (["xml", "mxl", "musicxml"].includes(ext)) {
      const text = await file.text();
      setScore(text);
      setScoreType("musicxml");
      setMarkings(analyzeMarkings(text));

      const rhythmMatch = text.match(/<time>\s*<beats>(\d+)<\/beats>\s*<beat-type>(\d+)<\/beat-type>/);
      const timeSignature = rhythmMatch ? `${rhythmMatch[1]}/${rhythmMatch[2]}` : "4/4";
      const tempoMatch = text.match(/<metronome>[\s\S]*?<per-minute>(\d+)<\/per-minute>/);
      const tempo = tempoMatch ? parseInt(tempoMatch[1]) : 120;
      const noteCount = (text.match(/<note\b/g) || []).length;
      const restCount = (text.match(/<rest\b/g) || []).length;

      setRhythmInfo({ time_signature: timeSignature, tempo_bpm: tempo, note_count: noteCount, rest_count: restCount });
      setMetronomeState(prev => ({ ...prev, bpm: tempo }));
      setCurrentRestAlert(null);
      setTrainingSegments([]);
      setScoreNoteNames(extractScoreNoteNames(text));
      setRestAlerts(extractRestAlerts(text));

      const markingsList = [];
      const measures = text.match(/<measure[^>]*number="([^"]*)"[^>]*>([\s\S]*?)<\/measure>/g) || [];
      measures.forEach(measure => {
        const measureMatch = measure.match(/number="([^"]*)"/);
        const measureNum = measureMatch ? parseInt(measureMatch[1]) : 0;
        if (measure.includes("<accent") || measure.includes("<staccato") || measure.includes("<tenuto"))
          markingsList.push({ measure: measureNum, type: "articulation", value: "accent/staccato" });
        if (measure.includes("<rest"))
          markingsList.push({ measure: measureNum, type: "rest", value: "rest" });
        if (measure.includes("<fermata"))
          markingsList.push({ measure: measureNum, type: "fermata", value: "fermata" });
      });
      setComplexMarkings(markingsList);
    } else if (["mscz", "mscx"].includes(ext)) {
      setScore(null);
      setScoreType("musescore");
      setMarkings([]);
    } else {
      setErrorMessage("Supported: .pdf, .xml, .musicxml, .mxl, .mscz, .mscx");
    }
    e.target.value = "";
  }

  // ── Metronome ────────────────────────────────────────────────────────────
  const startMetronome = useCallback(async () => {
    if (!rhythmInfo) return;
    setLoadingMetronome(true);
    try {
      const response = await fetch(
        `/playback/metronome?bpm=${metronomeState.bpm}&time_signature=${rhythmInfo.time_signature}&duration_seconds=8`,
        { method: "POST" }
      );
      if (response.ok) {
        const url = URL.createObjectURL(await response.blob());
        if (audioElementRef.current) {
          audioElementRef.current.src = url;
          await audioElementRef.current.play();
          setMetronomeState(prev => ({ ...prev, isPlaying: true }));
        }
      } else {
        setErrorMessage(`Metronome error: ${await response.text()}`);
      }
    } catch (e) {
      setErrorMessage(`Metronome failed: ${e.message}`);
    } finally {
      setLoadingMetronome(false);
    }
  }, [metronomeState.bpm, rhythmInfo]);

  const stopMetronome = useCallback(() => {
    if (audioElementRef.current) { audioElementRef.current.pause(); audioElementRef.current.currentTime = 0; }
    setMetronomeState(prev => ({ ...prev, isPlaying: false }));
  }, []);

  useEffect(() => {
    if (settings.metronomeEnabled && rhythmInfo) {
      startMetronome();
      return () => stopMetronome();
    }
    stopMetronome();
  }, [settings.metronomeEnabled, rhythmInfo, startMetronome, stopMetronome]);

  useEffect(() => {
    if (rhythmInfo?.tempo_bpm) setMetronomeState(prev => ({ ...prev, bpm: rhythmInfo.tempo_bpm }));
  }, [rhythmInfo]);

  // ── Sticky notes ─────────────────────────────────────────────────────────
  const handleStickyNoteClick = useCallback((event) => {
    if (!stickyNoteMode || !scoreContainerRef.current) return;
    const rect = scoreContainerRef.current.getBoundingClientRect();
    setStickyNotes(prev => [...prev, {
      id: Date.now(),
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
      measure: currentMeasure,
      text: "", color: "#FFFF88", editing: true,
    }]);
  }, [stickyNoteMode, currentMeasure]);

  const updateStickyNote = useCallback((id, updates) => {
    setStickyNotes(prev => prev.map(note => note.id === id ? { ...note, ...updates } : note));
  }, []);

  const deleteStickyNote = useCallback((id) => {
    setStickyNotes(prev => prev.filter(note => note.id !== id));
  }, []);

  // ── Wake word resume ──────────────────────────────────────────────────────
  const beginWakeWordResume = useCallback((measureNumber) => {
    const targetMeasure = Math.max(1, measureNumber - 1);
    setWakeWordNotice({ measure: targetMeasure, countdown: 4 });
    let count = 4;
    const interval = rhythmInfo ? (60 / rhythmInfo.tempo_bpm) * 1000 : 1000;
    const timer = setInterval(() => {
      count--;
      setWakeWordNotice(prev => prev ? { ...prev, countdown: count } : null);
      if (count <= 0) {
        clearInterval(timer);
        setCurrentMeasure(targetMeasure);
        setIsAutoScrollPaused(false);
        if (scoreContainerRef.current) scrollToMeasure(targetMeasure);
        setWakeWordNotice(null);
      }
    }, interval);
    wakeCountdownTimerRef.current = timer;
  }, [rhythmInfo, scrollToMeasure]);

  // ── Voice recognition ─────────────────────────────────────────────────────
  useEffect(() => {
    let voiceHandle = null;
    if (settings.voiceMeasureJumpEnabled && isListening) {
      voiceHandle = startVoiceRecognition((measureNumber) => {
        const targetMeasure = Math.max(1, measureNumber + 4);
        setCurrentMeasure(targetMeasure);
        setIsAutoScrollPaused(false);
        if (scoreContainerRef.current) scrollToMeasure(targetMeasure);
      }, (measureNumber) => {
        beginWakeWordResume(measureNumber);
      });
      setVoiceRecognitionActive(true);
    } else {
      if (voiceHandle) voiceHandle.stop();
      setVoiceRecognitionActive(false);
    }
    return () => { if (voiceHandle) voiceHandle.stop(); };
  }, [settings.voiceMeasureJumpEnabled, isListening, beginWakeWordResume, scrollToMeasure]);

  // ── Marking suggestions ───────────────────────────────────────────────────
  useEffect(() => {
    if (settings.markingSuggestionsEnabled && rhythmInfo && complexMarkings.length > 0) {
      const metrics = settings.liveAnalysisEnabled ? {
        rmsLevel, spectralCentroid, spectralFlatness, attackMs, releaseMs,
        hasVibrato: vibratoStrength > 0.4, vibratoStrength, noteCharacter: performanceArticulation,
      } : null;
      setMarkingSuggestions(generateMarkingSuggestions(currentMeasure, rhythmInfo, complexMarkings, metrics));
    } else {
      setMarkingSuggestions([]);
    }
  }, [currentMeasure, settings.markingSuggestionsEnabled, settings.liveAnalysisEnabled, rhythmInfo,
    complexMarkings, rmsLevel, spectralCentroid, spectralFlatness, attackMs, releaseMs,
    vibratoStrength, performanceArticulation]);

  // ── Mic start / stop ──────────────────────────────────────────────────────
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

  // ── Wrong note monitor ────────────────────────────────────────────────────
  useEffect(() => {
    if (!isListening || !currentNote) return;
    if (settings.stopAtWrongNote && scoreNoteNames.length > 0) {
      const bareNote = currentNote.replace(/\d+$/, "");
      if (!scoreNoteNames.includes(bareNote)) {
        setIsAutoScrollPaused(true);
        if (settings.loopOnWrongNote) setLoopMode("measure");
      }
    }
  }, [isListening, currentNote, settings.stopAtWrongNote, settings.loopOnWrongNote, scoreNoteNames]);

  // ── Main audio analysis loop ──────────────────────────────────────────────
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
        if (sustainMs < MIN_NOTE_STABILITY_MS) { rafRef.current = requestAnimationFrame(loop); return; }

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
        const vibrato = detectVibratoFromHistory(freqHistory);
        setVibratoStrength(vibrato.rate || 0);

        const spectrum = new Float32Array(analyserRef.current.frequencyBinCount);
        analyserRef.current.getFloatFrequencyData(spectrum);
        setSpectralCentroid(computeSpectralCentroid(spectrum, audioCtxRef.current.sampleRate));
        setSpectralFlatness(computeSpectralFlatness(spectrum));

        const attackDelta = currentRms - lastRmsRef.current;
        const attackTime  = attackDelta > 0.05 ? 30 : 120;
        const releaseTime = attackDelta < -0.05 ? 80 : 180;
        setAttackMs(attackTime);
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
          const upcomingRestMeasure = restAlerts.find(
            r => r.measure > currentMeasureEstimate && r.measure <= currentMeasureEstimate + settings.restAlertAdvance
          );
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

  // ── Auto-scroll ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (!autoScroll || !isListening || !scoreContainerRef.current) return;
    const id = setInterval(() => {
      if (isAutoScrollPaused) return;
      if (currentFreq > 0) scrollToOsmdCursor();
      else if (settings.pauseOnSilence) setIsAutoScrollPaused(true);
    }, 120);
    return () => clearInterval(id);
  }, [autoScroll, isListening, currentFreq, isAutoScrollPaused, settings.pauseOnSilence, scrollToOsmdCursor]);

  const tunerColor  = Math.abs(cents) < 10 ? "#2aee6e" : Math.abs(cents) < 25 ? "#f5c542" : "#ee4444";
  const tunerOffset = Math.max(-50, Math.min(50, cents));

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <div style={styles.mainBg}>
      {/* Top bar */}
      <div style={styles.topBar}>
        <div style={styles.topBrand}>
          <svg width="28" height="28" viewBox="0 0 40 40" fill="none">
            <circle cx="20" cy="20" r="20" fill="#C9A84C"/>
            <text x="20" y="27" textAnchor="middle" fontSize="20" fill="#1a1a1a" fontFamily="serif">♩</text>
          </svg>
          <span style={styles.topBrandName}>ScoreSync</span>
        </div>
        <div style={styles.topControls}>
          <label style={styles.uploadBtn}>
            Load Score
            <input type="file" accept=".pdf,.xml,.musicxml,.mxl,.mscz,.mscx" style={{ display:"none" }} onChange={handleFileLoad}/>
          </label>
          <button style={{ ...styles.micBtn, ...(showComposer ? { background:"#C9A84C22", border:"1px solid #C9A84C", color:"#C9A84C" } : {}) }}
            onClick={() => setShowComposer(v => !v)}>
            ✍ Compose
          </button>
          <button style={{ ...styles.micBtn, ...(isListening ? styles.micBtnActive : {}) }}
            onClick={isListening ? stopMic : startMic}>
            {isListening ? "Stop Mic" : "Start Mic"}
          </button>
          <label style={styles.topToggle}>
            <input type="checkbox" checked={autoScroll} onChange={e => setAutoScroll(e.target.checked)} style={{ marginRight:6 }}/>
            Auto-scroll
          </label>
          {isAutoScrollPaused && (
            <button style={{ ...styles.micBtn, background:"#2a5", border:"1px solid #4a9" }}
              onClick={() => setIsAutoScrollPaused(false)}>
              Resume
            </button>
          )}
          {loopMode !== "none" && (
            <span style={{ fontSize:11, color:"#C9A84C", padding:"4px 8px", background:"#2a2010", borderRadius:4 }}>
              🔁 {loopMode === "measure" ? "Measure Loop" : "Phrase Loop"}
            </span>
          )}
          <button style={{ ...styles.micBtn, ...(stickyNoteMode ? { background:"#C9A84C", color:"#1a1200" } : {}) }}
            onClick={() => setStickyNoteMode(!stickyNoteMode)}>
            {stickyNoteMode ? "Exit Notes" : "Sticky Notes"}
          </button>
          {voiceRecognitionActive && (
            <span style={{ fontSize:11, color:"#2aee6e", padding:"4px 8px", background:"#1a2a1a", borderRadius:4 }}>
              Voice Active
            </span>
          )}
          <div style={styles.userBadge} onClick={() => setShowProfile(p => !p)}>
            <div style={styles.avatar}>{user.name[0].toUpperCase()}</div>
            <span style={styles.userName}>{user.name}</span>
          </div>
        </div>
      </div>

      {/* Profile dropdown */}
      {showProfile && (
        <div style={styles.profileDrop}>
          <div style={styles.profileItem}><strong>{user.name}</strong></div>
          <div style={styles.profileItem}>{user.email}</div>
          <div style={styles.profileItem}>{profile.instrument}</div>
          <button style={styles.profileBtn} onClick={onRecalibrate}>Recalibrate</button>
          <button style={{ ...styles.profileBtn, color:"#ee4444" }} onClick={onLogout}>Sign Out</button>
        </div>
      )}

      {/* Error banner */}
      {errorMessage && (
        <div style={styles.errorBanner}>
          <span>{errorMessage}</span>
          <button style={styles.errorDismiss} onClick={() => setErrorMessage(null)}>Dismiss</button>
        </div>
      )}

      {/* Rest alert banner (top) */}
      {currentRestAlert && settings.restAlertEnabled && (
        <div style={styles.alertBanner}>
          Rest Alert: Measure {currentRestAlert.measure} in {currentRestAlert.beatsUntil.toFixed(1)} beat(s)
        </div>
      )}

      {/* Tempo prompter */}
      {tempoPrompt && rhythmInfo && (
        <div style={styles.tempoPrompter}>
          <div style={styles.tempoTitle}>Tempo: {metronomeState.bpm} BPM</div>
          <div style={styles.tempoSubtitle}>{rhythmInfo.time_signature}</div>
          <div style={{ display:"flex", gap:8, marginTop:12, justifyContent:"center" }}>
            <button style={styles.tempoBtn} onClick={startMetronome}>
              {metronomeState.isPlaying ? "Stop" : "Play Metronome"}
            </button>
            <button style={{ ...styles.tempoBtn, background:"#1e1a14" }} onClick={() => setTempoPrompt(false)}>
              Ready
            </button>
          </div>
        </div>
      )}

      {/* Wake-word countdown */}
      {wakeWordNotice && (
        <div style={{ ...styles.tempoPrompter, background:"#1a2a1a", border:"2px solid #2aee6e" }}>
          <div style={{ ...styles.tempoTitle, color:"#2aee6e" }}>Resuming in {wakeWordNotice.countdown}…</div>
          <div style={styles.tempoSubtitle}>Measure {wakeWordNotice.measure}</div>
        </div>
      )}

      {/* Main body */}
      <div style={styles.mainBody}>

        {/* Score panel */}
        <div style={styles.scorePanel} ref={scoreContainerRef}>

          {/* Rest alert (inline) */}
          {settings.restAlertEnabled && currentRestAlert && (
            <div style={{ ...styles.restAlertBanner, background: currentRestAlert.isCritical ? "#8b2e2e" : "#3a3824" }}>
              <div style={{ fontSize:14, fontWeight:700, color: currentRestAlert.isCritical ? "#ff6b6b" : "#C9A84C" }}>
                REST ALERT — Measure {currentRestAlert.measure}
              </div>
              <div style={{ fontSize:12, color: currentRestAlert.isCritical ? "#ffb3b3" : "#d4af9f", marginTop:4 }}>
                {currentRestAlert.isCritical ? "REST ENDS IN 1 BEAT" : `Rest in ${currentRestAlert.beatsUntil.toFixed(1)} beats`}
              </div>
            </div>
          )}

          {/* Marking suggestions */}
          {settings.markingSuggestionsEnabled && markingSuggestions.length > 0 && (
            <div style={styles.markingSuggestionsBanner}>
              <div style={{ fontSize:14, fontWeight:700, color:"#C9A84C", marginBottom:4 }}>Performance Suggestions</div>
              {markingSuggestions.slice(0, 2).map((suggestion, i) => (
                <div key={i} style={{ fontSize:12, color:"#d4af9f", marginBottom:2 }}>● {suggestion.suggestion}</div>
              ))}
              {performanceArticulation && (
                <div style={{ fontSize:11, color:"#b9a46a", marginTop:6 }}>
                  Live analysis: {performanceArticulation} character detected
                </div>
              )}
            </div>
          )}

          {/* Sticky notes overlay */}
          {settings.stickyNotesEnabled && stickyNotes.length > 0 && (
            <div style={styles.stickyNotesOverlay}>
              {stickyNotes.map(note => (
                <div key={note.id}
                  style={{ ...styles.stickyNote, left: note.x, top: note.y, backgroundColor: note.color }}
                  onClick={e => { e.stopPropagation(); if (!note.editing) updateStickyNote(note.id, { editing: true }); }}
                  onContextMenu={e => { e.preventDefault(); if (confirm("Delete this sticky note?")) deleteStickyNote(note.id); }}>
                  {note.editing ? (
                    <input style={styles.stickyNoteInput} value={note.text}
                      onChange={e => updateStickyNote(note.id, { text: e.target.value })}
                      onBlur={() => updateStickyNote(note.id, { editing: false })}
                      onKeyDown={e => { if (e.key === "Enter") updateStickyNote(note.id, { editing: false }); }}
                      autoFocus />
                  ) : (
                    <div style={styles.stickyNoteText}>{note.text || "Click to edit"}</div>
                  )}
                  <div style={styles.stickyNoteMeasure}>M{note.measure}</div>
                </div>
              ))}
            </div>
          )}

          {/* Sticky note click mode overlay */}
          {stickyNoteMode && (
            <div style={styles.stickyNoteModeOverlay} onClick={handleStickyNoteClick}>
              <div style={styles.stickyNoteModeHint}>📝 Click anywhere on the score to add a sticky note</div>
            </div>
          )}

          {/* Score content */}
          {!score ? (
            <div style={styles.scorePlaceholder}>
              <div style={styles.placeholderIcon}>S</div>
              <div style={styles.placeholderText}>Load a score to begin</div>
              <div style={styles.placeholderSub}>
                Supports PDF, MusicXML (.xml, .mxl, .musicxml)<br/>
                MuseScore files require server-side conversion
              </div>
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
              <div style={styles.placeholderSub}>
                MuseScore files can be converted by the connected backend when MuseScore CLI is configured.
              </div>
            </div>
          )}
        </div>

        {/* Right panel */}
        <div style={styles.rightPanel}>
          {/* Pitch card */}
          <div style={styles.pitchCard}>
            <div style={styles.pitchTitle}>Live Pitch</div>
            {currentNote ? (
              <>
                <div style={styles.bigNote}>{currentNote}</div>
                <div style={styles.freqLine}>{currentFreq.toFixed(2)} Hz</div>
                <div style={styles.tunerTrack}>
                  <div style={{ ...styles.tunerNeedle, left:`calc(50% + ${tunerOffset}%)`, background: tunerColor }}/>
                  <div style={styles.tunerCenter}/>
                </div>
                <div style={{ ...styles.centsLabel, color: tunerColor }}>
                  {cents > 0 ? "+" : ""}{cents.toFixed(1)} cents
                </div>
              </>
            ) : (
              <div style={styles.pitchIdle}>
                {isListening ? "Listening…" : "Start mic to detect pitch"}
              </div>
            )}
          </div>

          {/* Note history */}
          <div style={styles.historyCard}>
            <div style={styles.pitchTitle}>Recent Notes</div>
            <div style={styles.historyScroll}>
              {noteHistory.length === 0 && <span style={{ color:"#555", fontSize:12 }}>Notes will appear here</span>}
              {[...noteHistory].reverse().slice(0, 20).map((n, i) => (
                <span key={i} style={{ ...styles.historyNote, opacity: 1 - i * 0.045 }}>{n.note}</span>
              ))}
            </div>
          </div>

          {/* Sidebar tabs */}
          <div style={styles.sidebarTabs}>
            {["markings","info","training","metronome","settings"].map(t => (
              <button key={t}
                style={{ ...styles.sidebarTab, ...(sidebarTab === t ? styles.sidebarTabActive : {}) }}
                onClick={() => setSidebarTab(t)}>
                {t.charAt(0).toUpperCase() + t.slice(1)}
              </button>
            ))}
          </div>

          {/* Markings tab */}
          {sidebarTab === "markings" && (
            <div style={styles.markingsCard}>
              {markings.length === 0 ? (
                <div style={{ color:"#555", fontSize:12, padding:8 }}>
                  Load a MusicXML file to analyze stylistic markings
                </div>
              ) : markings.map((m, i) => (
                <div key={i} style={styles.markingItem}>
                  <span style={styles.markingType}>{m.type}</span>
                  <span style={styles.markingCount}>×{m.count}</span>
                  <span style={styles.markingDetail}>{m.detail}</span>
                </div>
              ))}
            </div>
          )}

          {/* Info tab */}
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
                    `${Math.abs(TRANSPOSITIONS[profile.instrument])} st ${TRANSPOSITIONS[profile.instrument] > 0 ? "up" : "down"}`}
                </span>
              </div>
              <div style={styles.infoRow}>
                <span style={styles.infoLabel}>Calibration</span>
                <span style={styles.infoVal}>
                  {profile.calibration?.skipped ? "Skipped" :
                    profile.calibration ? `${Object.keys(profile.calibration).length} scales` : "None"}
                </span>
              </div>
              <button style={{ ...styles.profileBtn, marginTop:12, width:"100%" }} onClick={onRecalibrate}>
                Recalibrate
              </button>
            </div>
          )}

          {/* Training tab */}
          {sidebarTab === "training" && (
            <div style={styles.markingsCard}>
              <div style={{ fontSize:12, color:"#a89060", marginBottom:8 }}>
                <strong>Training Mode</strong> — Practice with synthesized playback and segment control
              </div>
              {!score ? (
                <div style={{ fontSize:11, color:"#665040", padding:8, background:"#1a1610", borderRadius:4 }}>
                  Load a score to enable training mode.
                </div>
              ) : (
                <>
                  <div style={styles.settingRow}>
                    <label style={{ display:"flex", alignItems:"center", gap:6, cursor:"pointer" }}>
                      <input type="checkbox" checked={trainingMode}
                        onChange={e => setTrainingMode(e.target.checked)} style={{ marginRight:0 }}/>
                      <span style={{ fontSize:12, color:"#a89060" }}>Enable training mode</span>
                    </label>
                  </div>
                  {trainingMode && rhythmInfo && (
                    <>
                      <div style={{ fontSize:11, color:"#665040", marginTop:8, padding:8, background:"#1a1610", borderRadius:4 }}>
                        Tempo: {rhythmInfo.tempo_bpm} BPM | Time: {rhythmInfo.time_signature}<br/>
                        Notes: {rhythmInfo.note_count} | Rests: {rhythmInfo.rest_count}<br/>
                        Current Measure: {currentMeasure}
                      </div>
                      <div style={{ marginTop:12, marginBottom:8 }}>
                        <div style={{ fontSize:11, color:"#a89060", marginBottom:6 }}>Playback Controls</div>
                        <div style={{ display:"flex", gap:6, marginBottom:8 }}>
                          <button style={{ ...styles.profileBtn, flex:1, fontSize:11 }}
                            disabled={loadingSynthesis}
                            onClick={async () => {
                              if (!score || scoreType !== "musicxml") return;
                              setLoadingSynthesis(true);
                              const form = new FormData();
                              form.append("file", new Blob([score], { type:"application/xml" }), "score.xml");
                              if (rhythmInfo?.tempo_bpm) form.append("tempo_override", String(rhythmInfo.tempo_bpm));
                              try {
                                const response = await fetch("/scores/training/synthesize", { method:"POST", body:form });
                                if (response.ok) {
                                  const url = URL.createObjectURL(await response.blob());
                                  if (audioElementRef.current) { audioElementRef.current.src = url; await audioElementRef.current.play(); }
                                } else { setErrorMessage(`Synthesis failed: ${await response.text()}`); }
                              } catch (err) { setErrorMessage(`Synthesis error: ${err.message}`); }
                              finally { setLoadingSynthesis(false); }
                            }}>
                            {loadingSynthesis ? "Synthesizing..." : "Synth Track"}
                          </button>
                          <button style={{ ...styles.profileBtn, flex:1, fontSize:11, background:"#2a5" }}
                            onClick={() => {
                              if (audioElementRef.current) { audioElementRef.current.pause(); audioElementRef.current.currentTime = 0; }
                            }}>
                            ■ Stop
                          </button>
                        </div>
                      </div>
                      <button style={{ ...styles.profileBtn, marginTop:6, width:"100%", background:"#1e1a14" }}
                        onClick={async () => {
                          if (!score || scoreType !== "musicxml") return;
                          const form = new FormData();
                          form.append("file", new Blob([score], { type:"application/xml" }), "score.xml");
                          form.append("segment_size", String(numberOfSegments));
                          try {
                            const response = await fetch("/scores/training/segments", { method:"POST", body:form });
                            if (response.ok) { setTrainingSegments((await response.json()).segments || []); }
                            else { setErrorMessage(`Segment extraction failed: ${await response.text()}`); }
                          } catch (err) { setErrorMessage(`Segment error: ${err.message}`); }
                        }}>
                        Extract Segments
                      </button>
                      {trainingSegments.length > 0 && (
                        <div style={{ marginTop:12, borderTop:"1px solid #2a2010", paddingTop:10 }}>
                          <div style={{ fontSize:11, color:"#a89060", marginBottom:6 }}>
                            Practice Segments ({trainingSegments.length})
                          </div>
                          <div style={{ maxHeight:200, overflow:"auto" }}>
                            {trainingSegments.map(segment => (
                              <div key={segment.segment_id}
                                style={{ fontSize:12, color:"#d8cfa3", marginBottom:6, padding:8, background:"#1a1610", borderRadius:6, cursor:"pointer" }}
                                onClick={() => { setCurrentMeasure(segment.start_measure); if (scoreContainerRef.current) scrollToMeasure(segment.start_measure); }}>
                                <div style={{ fontWeight:700 }}>Segment {segment.segment_id}: M{segment.start_measure}–{segment.end_measure}</div>
                                <div style={{ fontSize:11, color:"#8e7b55", marginTop:2 }}>
                                  {segment.measure_count} measures — rests: {segment.markings.hasRests ? "yes" : "no"}, accents: {segment.markings.hasAccents ? "yes" : "no"}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      <div style={{ marginTop:12, padding:8, background:"#1a1610", borderRadius:4 }}>
                        <div style={{ fontSize:11, color:"#a89060", marginBottom:4 }}>Practice Statistics</div>
                        <div style={{ fontSize:10, color:"#665040" }}>
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

          {/* Metronome tab */}
          {sidebarTab === "metronome" && (
            <div style={styles.markingsCard}>
              <div style={{ fontSize:12, color:"#a89060", marginBottom:8 }}>
                <strong>Metronome</strong> — Practice timing and rhythm
              </div>
              {!rhythmInfo ? (
                <div style={{ fontSize:11, color:"#665040", padding:8, background:"#1a1610", borderRadius:4 }}>
                  Load a score to enable metronome features.
                </div>
              ) : (
                <>
                  <div style={{ fontSize:11, color:"#665040", marginTop:8, padding:8, background:"#1a1610", borderRadius:4 }}>
                    Tempo: {rhythmInfo.tempo_bpm} BPM | Time: {rhythmInfo.time_signature}
                  </div>
                  <div style={styles.settingRow}>
                    <label style={{ display:"flex", alignItems:"center", gap:6, cursor:"pointer" }}>
                      <input type="checkbox" checked={settings.metronomeEnabled}
                        onChange={e => setSettings({ ...settings, metronomeEnabled: e.target.checked })} style={{ marginRight:0 }}/>
                      <span style={{ fontSize:12, color:"#a89060" }}>Enable metronome</span>
                    </label>
                  </div>
                  {settings.metronomeEnabled && (
                    <>
                      <div style={{ marginTop:12, marginBottom:8 }}>
                        <div style={{ fontSize:11, color:"#a89060", marginBottom:6 }}>Metronome Controls</div>
                        <div style={{ display:"flex", gap:6, marginBottom:8 }}>
                          <button style={{ ...styles.profileBtn, flex:1, fontSize:11, background:"#2a5" }} onClick={startMetronome}>▶ Start</button>
                          <button style={{ ...styles.profileBtn, flex:1, fontSize:11, background:"#a52" }} onClick={stopMetronome}>■ Stop</button>
                        </div>
                      </div>
                      <button style={{ ...styles.profileBtn, marginTop:6, width:"100%", background:"#1e1a14" }}
                        onClick={async () => {
                          try {
                            const params = new URLSearchParams({ bpm: String(rhythmInfo.tempo_bpm), time_signature: rhythmInfo.time_signature, duration_seconds:"30", accent_first:"true" });
                            const response = await fetch(`/playback/metronome?${params}`, { method:"POST" });
                            if (response.ok) {
                              const url = URL.createObjectURL(await response.blob());
                              if (audioElementRef.current) { audioElementRef.current.src = url; await audioElementRef.current.play(); }
                            } else { setErrorMessage(`Metronome generation failed: ${await response.text()}`); }
                          } catch (err) { setErrorMessage(`Metronome error: ${err.message}`); }
                        }}>
                        Generate Metronome Track
                      </button>
                      <div style={{ marginTop:12, padding:8, background:"#1a1610", borderRadius:4 }}>
                        <div style={{ fontSize:11, color:"#a89060", marginBottom:4 }}>Metronome Settings</div>
                        <div style={{ fontSize:10, color:"#665040" }}>
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

          {/* Settings tab */}
          {sidebarTab === "settings" && (
            <div style={styles.markingsCard}>
              {[
                ["stopAtWrongNote",          "Stop on wrong note"],
                ["loopOnWrongNote",          "Loop on wrong note"],
                ["pauseOnSilence",           "Pause scroll on silence"],
                ["metronomeEnabled",         "Enable metronome"],
                ["restAlertEnabled",         "Rest alerts"],
                ["markingSuggestionsEnabled","Marking suggestions"],
                ["stickyNotesEnabled",       "Sticky notes"],
                ["voiceMeasureJumpEnabled",  "Voice measure jumping"],
                ["liveAnalysisEnabled",      "Live performance analysis"],
              ].map(([key, label]) => (
                <div key={key} style={styles.settingRow}>
                  <label style={{ display:"flex", alignItems:"center", gap:6, cursor:"pointer" }}>
                    <input type="checkbox" checked={settings[key]}
                      onChange={e => setSettings({ ...settings, [key]: e.target.checked })} style={{ marginRight:0 }}/>
                    <span style={{ fontSize:12, color:"#a89060" }}>{label}</span>
                  </label>
                </div>
              ))}
              {settings.metronomeEnabled && (
                <div style={styles.settingRow}>
                  <select value={settings.metronomeSource}
                    onChange={e => setSettings({ ...settings, metronomeSource: e.target.value })}
                    style={{ fontSize:12, width:"100%", padding:"4px", background:"#1e1a14", border:"1px solid #3a2e1e", color:"#a89060", borderRadius:4 }}>
                    <option value="backend">Backend Metronome</option>
                    <option value="client">Client Metronome</option>
                  </select>
                </div>
              )}
              {settings.restAlertEnabled && (
                <div style={{ ...styles.settingRow, marginTop:4 }}>
                  <span style={{ fontSize:11, color:"#665040" }}>Alert {settings.restAlertAdvance} beat(s) before</span>
                  <input type="number" min="1" max="8" value={settings.restAlertAdvance}
                    onChange={e => setSettings({ ...settings, restAlertAdvance: parseInt(e.target.value) })}
                    style={{ width:"40px", padding:"3px", marginLeft:"auto", background:"#1e1a14", border:"1px solid #3a2e1e", color:"#a89060", borderRadius:4 }}/>
                </div>
              )}
              {rhythmInfo && (
                <button style={{ ...styles.profileBtn, marginTop:12, width:"100%", background:"#C9A84C22", color:"#C9A84C", border:"1px solid #C9A84C" }}
                  onClick={() => setTempoPrompt(true)}>
                  Start Tempo Prompt
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Hidden audio element */}
      <audio ref={audioElementRef} style={{ display:"none" }}/>

      {/* Composer overlay */}
      {showComposer && <ComposerOverlay onClose={() => setShowComposer(false)} />}
    </div>
  );
}
