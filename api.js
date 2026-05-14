// api.js — Backend API helpers

export async function apiRequest(path, options = {}) {
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

export function normalizeProfile(profile) {
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

export function calibrationToRequest(calibration) {
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
