// pitchUtils.js — Pitch detection & audio analysis utilities

import { NOTE_NAMES } from "./constants.js";

export function yin(buffer, sampleRate) {
  const threshold = 0.12;
  const N = buffer.length;
  const halfN = Math.floor(N / 2);
  const yinBuffer = new Float32Array(halfN);

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

  let tau = 2;
  while (tau < halfN) {
    if (yinBuffer[tau] < threshold) {
      while (tau + 1 < halfN && yinBuffer[tau + 1] < yinBuffer[tau]) tau++;
      const better = tau + 0.5 * (yinBuffer[tau - 1] - yinBuffer[tau + 1]) /
        (yinBuffer[tau - 1] - 2 * yinBuffer[tau] + yinBuffer[tau + 1] || 1e-10);
      return sampleRate / better;
    }
    tau++;
  }
  return 0;
}

export function freqToMidi(freq) {
  return Math.round(12 * Math.log2(freq / 440) + 69);
}

export function midiToNoteName(midi) {
  return NOTE_NAMES[((midi % 12) + 12) % 12];
}

export function freqToNoteLabel(freq) {
  const midi = freqToMidi(freq);
  const octave = Math.floor(midi / 12) - 1;
  return midiToNoteName(midi) + octave;
}

export function centsDiff(freq, midi) {
  const idealFreq = 440 * Math.pow(2, (midi - 69) / 12);
  return 1200 * Math.log2(freq / idealFreq);
}

export function computeRMS(buffer) {
  let sum = 0;
  for (let i = 0; i < buffer.length; i++) sum += buffer[i] * buffer[i];
  return Math.sqrt(sum / buffer.length);
}

export function computeSpectralCentroid(spectrum, sampleRate) {
  let weightedSum = 0, totalPower = 0;
  const binWidth = sampleRate / (2 * spectrum.length);
  for (let i = 0; i < spectrum.length; i++) {
    const power = Math.pow(10, spectrum[i] / 10);
    weightedSum += power * i * binWidth;
    totalPower += power;
  }
  return totalPower > 0 ? weightedSum / totalPower : 0;
}

export function computeSpectralFlatness(spectrum) {
  let logSum = 0, sum = 0;
  const powers = spectrum.map(db => Math.pow(10, db / 10));
  powers.forEach(p => { logSum += Math.log(p + 1e-10); sum += p; });
  const geoMean = Math.exp(logSum / powers.length);
  const arithMean = sum / powers.length;
  return arithMean > 0 ? geoMean / arithMean : 0;
}

export function detectVibratoFromHistory(freqHistory) {
  if (freqHistory.length < 16) return { rate: 0, depth: 0 };
  const recent = freqHistory.slice(-32);
  const mean = recent.reduce((a, b) => a + b, 0) / recent.length;
  const deviations = recent.map(f => f - mean);
  let crossings = 0;
  for (let i = 1; i < deviations.length; i++) {
    if (deviations[i - 1] * deviations[i] < 0) crossings++;
  }
  const rate = crossings / 2;
  const depth = Math.max(...deviations.map(Math.abs));
  return { rate, depth };
}
