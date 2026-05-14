// audioPlayback.js — Composer Web Audio playback engine

const INSTRUMENT_VOICE = {
  default:          { type: "sine",     attack: 0.02, decay: 0.1,  sustain: 0.7, release: 0.3,  gain: 0.4 },
  Piano:            { type: "triangle", attack: 0.01, decay: 0.4,  sustain: 0.3, release: 0.8,  gain: 0.5 },
  Flute:            { type: "sine",     attack: 0.06, decay: 0.05, sustain: 0.8, release: 0.2,  gain: 0.35 },
  Oboe:             { type: "sawtooth", attack: 0.04, decay: 0.1,  sustain: 0.7, release: 0.15, gain: 0.25 },
  "English Horn":   { type: "sawtooth", attack: 0.05, decay: 0.12, sustain: 0.65, release: 0.2, gain: 0.28 },
  Bassoon:          { type: "sawtooth", attack: 0.04, decay: 0.15, sustain: 0.6, release: 0.25, gain: 0.3 },
  Clarinet:         { type: "square",   attack: 0.03, decay: 0.08, sustain: 0.75, release: 0.15, gain: 0.2 },
  Trumpet:          { type: "sawtooth", attack: 0.02, decay: 0.05, sustain: 0.85, release: 0.1, gain: 0.35 },
  Flugelhorn:       { type: "sine",     attack: 0.04, decay: 0.08, sustain: 0.75, release: 0.2, gain: 0.32 },
  Horn:             { type: "sine",     attack: 0.06, decay: 0.1,  sustain: 0.8, release: 0.3,  gain: 0.3 },
  Trombone:         { type: "sawtooth", attack: 0.04, decay: 0.1,  sustain: 0.8, release: 0.25, gain: 0.32 },
  "Bass Trombone":  { type: "sawtooth", attack: 0.05, decay: 0.12, sustain: 0.8, release: 0.3,  gain: 0.35 },
  Euphonium:        { type: "sine",     attack: 0.05, decay: 0.1,  sustain: 0.8, release: 0.3,  gain: 0.35 },
  Tuba:             { type: "sine",     attack: 0.06, decay: 0.15, sustain: 0.75, release: 0.4, gain: 0.4 },
  Violin:           { type: "sawtooth", attack: 0.05, decay: 0.05, sustain: 0.9, release: 0.2,  gain: 0.3 },
  Viola:            { type: "sawtooth", attack: 0.06, decay: 0.06, sustain: 0.88, release: 0.25, gain: 0.3 },
  Cello:            { type: "sawtooth", attack: 0.07, decay: 0.08, sustain: 0.85, release: 0.3, gain: 0.35 },
};

function midiToHz(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

function voiceForInstrument(name) {
  for (const key of Object.keys(INSTRUMENT_VOICE)) {
    if (name && name.toLowerCase().includes(key.toLowerCase())) return INSTRUMENT_VOICE[key];
  }
  return INSTRUMENT_VOICE.default;
}

export function playCompositionPreview(comp, onEnd) {
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) { onEnd && onEnd(); return () => {}; }

  const ctx = new AudioCtx();
  const masterGain = ctx.createGain();
  masterGain.gain.value = 0.8;
  masterGain.connect(ctx.destination);

  const beatsPerMeasure = parseInt((comp.time_signature || "4/4").split("/")[0]);
  const secPerBeat = 60 / (comp.tempo || 120);
  const scheduledNodes = [];

  function scheduleNote(midi, startBeat, durBeats, v) {
    const freq = midiToHz(midi);
    const startTime = ctx.currentTime + startBeat * secPerBeat;
    const durSec = durBeats * secPerBeat;

    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    osc.type = v.type;
    osc.frequency.value = freq;

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

  (comp.parts || []).forEach(part => {
    const voice = voiceForInstrument(part.instrument || part.role);
    (part.notes || []).forEach(n => {
      const globalBeat = (n.measure - 1) * beatsPerMeasure + (n.beat - 1);
      scheduleNote(n.pitch_midi || 60, globalBeat, n.duration || 1, voice);
      totalBeats = Math.max(totalBeats, globalBeat + (n.duration || 1));
    });
  });

  if (comp.drum_pattern) {
    const pat = comp.drum_pattern.pattern || {};
    const steps = comp.drum_pattern.steps || 16;
    const secPerStep = secPerBeat / 4;
    const totalSteps = comp.measures * steps;
    Object.entries(pat).forEach(([rowId, arr]) => {
      for (let step = 0; step < totalSteps; step++) {
        if (arr[step % arr.length] !== 1) continue;
        const startTime = ctx.currentTime + step * secPerStep;
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

  (comp.piano_rolls || []).forEach(roll => {
    const voice = voiceForInstrument("Piano");
    (roll.cells || []).forEach(c => {
      const globalBeat = c.beat_16th / 4;
      scheduleNote(c.pitch_midi || 60, globalBeat, (c.duration_16th || 1) / 4, voice);
      totalBeats = Math.max(totalBeats, globalBeat + (c.duration_16th || 1) / 4);
    });
  });

  const endTimeout = setTimeout(() => {
    ctx.close();
    onEnd && onEnd();
  }, (totalBeats * secPerBeat + 1) * 1000);

  return function stop() {
    clearTimeout(endTimeout);
    scheduledNodes.forEach(n => { try { n.stop(); } catch (_) {} });
    ctx.close();
    onEnd && onEnd();
  };
}

// Wire global used by ComposerOverlay play button
window.__composerPlayback = null;
window.__playComposition = function (comp, setPlaying) {
  if (window.__composerPlayback) {
    window.__composerPlayback();
    window.__composerPlayback = null;
    setPlaying(false);
    return;
  }
  const stop = playCompositionPreview(comp, () => {
    window.__composerPlayback = null;
    setPlaying(false);
  });
  window.__composerPlayback = stop;
  setPlaying(true);
};
