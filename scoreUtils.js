// scoreUtils.js — MusicXML analysis utilities

export function analyzeMarkings(xmlText) {
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
    const regex = new RegExp(`<${tag}[\\s/>]`, "g");
    const matches = xmlText.match(regex);
    if (matches && matches.length) {
      results.push({ type: label, count: matches.length, detail: "Found in score" });
    }
  });

  const dynCount = {};
  dynamicValues.forEach(dyn => {
    const m = xmlText.match(new RegExp(`<${dyn}/>`, "g"));
    if (m) dynCount[dyn] = m.length;
  });
  if (Object.keys(dynCount).length) {
    const detail = Object.entries(dynCount).map(([k, v]) => `${k}×${v}`).join(", ");
    results.push({
      type: "Dynamic markings",
      count: Object.values(dynCount).reduce((a, b) => a + b, 0),
      detail,
    });
  }

  return results;
}

export function extractScoreNoteNames(xmlText) {
  const noteSet = new Set();
  const stepMatches = xmlText.match(/<step>([A-G])<\/step>/g) || [];
  stepMatches.forEach(m => {
    const s = m.match(/<step>([A-G])<\/step>/);
    if (s) noteSet.add(s[1]);
  });
  return Array.from(noteSet);
}

export function extractRestAlerts(xmlText) {
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

export function generateMarkingSuggestions(currentMeasure, rhythmInfo, complexMarkings, liveMetrics) {
  const suggestions = [];
  const upcoming = complexMarkings.filter(
    m => m.measure >= currentMeasure && m.measure <= currentMeasure + 2
  );

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
