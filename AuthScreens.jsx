import { useState } from "react";
import { styles } from "./styles.js";
import { TRANSPOSITIONS, MAJOR_SCALES, MEYER_SCALES, NOTE_NAMES } from "./constants.js";
import { yin, freqToMidi, midiToNoteName, freqToNoteLabel } from "./pitchUtils.js";
import { useRef, useEffect, useCallback } from "react";

// ─── Auth Screen ──────────────────────────────────────────────────────────

export function AuthScreen({ mode, form, error, onFormChange, onLogin, onSignup, onToggleMode }) {
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
            value={form.name} onChange={e => onFormChange({ ...form, name: e.target.value })} />
        )}
        <input style={styles.authInput} placeholder="Email" type="email"
          value={form.email} onChange={e => onFormChange({ ...form, email: e.target.value })} />
        <input style={styles.authInput} placeholder="Password" type="password"
          value={form.password} onChange={e => onFormChange({ ...form, password: e.target.value })} />
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

// ─── Instrument Screen ────────────────────────────────────────────────────

export function InstrumentScreen({ onSave }) {
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

// ─── Calibration Screen ───────────────────────────────────────────────────

export function CalibrationScreen({ instrument, onDone, onSkip }) {
  const ALL_SCALES = [...MAJOR_SCALES, ...MEYER_SCALES];
  const [step, setStep] = useState(0);
  const [isListening, setIsListening] = useState(false);
  const [detectedNotes, setDetectedNotes] = useState([]);
  const [currentFreq, setCurrentFreq] = useState(0);
  const [calibData, setCalibData] = useState({});
  const [phase, setPhase] = useState("intro"); // intro | playing | done
  const audioCtxRef = useRef(null);
  const analyserRef = useRef(null);
  const rafRef = useRef(null);
  const bufRef = useRef(null);
  const streamRef = useRef(null);

  const scale = ALL_SCALES[step];
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
              Calibration is optional. You can play a few scales now, or skip and let ScoreSync learn
              your tuning tendencies during practice.
            </p>
            <p style={{ color: "#C9A84C", fontSize: 13 }}>
              All scales displayed in <strong>concert pitch</strong>.
              {TRANSPOSITIONS[instrument] !== 0 &&
                ` Your ${instrument} part will be transposed automatically.`}
            </p>
            <div style={{ display: "flex", gap: 12, marginTop: 20 }}>
              <button style={styles.authBtn} onClick={() => { setPhase("playing"); startMic(); }}>
                Start Calibration
              </button>
              <button style={{ ...styles.authToggle, border: "1px solid #444", borderRadius: 8, padding: "10px 20px" }}
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
              <div style={{ ...styles.progressFill, width: `${progress}%` }} />
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
                <span style={{ color: "#666" }}>Play the scale above ascending and descending</span>
              )}
            </div>
            <div style={{ display: "flex", gap: 12, marginTop: 20, justifyContent: "center" }}>
              {!isListening ? (
                <button style={styles.authBtn} onClick={startMic}>Start Listening</button>
              ) : (
                <>
                  <button style={{ ...styles.authBtn, background: "#2a5" }} onClick={handleSaveAndNext}>
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
