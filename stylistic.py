"""
Local stylistic analysis for ScoreSync.

The analyzer is intentionally rule-based so the backend works without an
external AI service. The frontend uses a richer interactive version of these
same ideas for accept/deny coaching suggestions.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, asdict


@dataclass
class StyleFinding:
    type: str
    count: int
    detail: str


@dataclass
class MarkingInfo:
    measure: int
    marking_type: str  # "accent", "articulation", "rest", "fermata", "ornament", etc.
    detail: str  # "staccato", "tenuto", "trill", "turn", etc.

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class RestAlert:
    measure: int
    beat: float
    duration_beats: float
    alert_at_beats: float  # When to show alert (2 beats before rest ends)
    rest_type: str  # "whole", "half", "quarter", etc.

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class RhythmInfo:
    time_signature: str
    tempo_bpm: int | None
    note_count: int
    rest_count: int
    complex_rhythms: list[str]

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class StyleReport:
    findings: list[StyleFinding]
    rehearsal_letters: list[dict]
    suggestions: list[dict]
    rhythm_info: RhythmInfo | None = None
    complex_markings: list[MarkingInfo] | None = None
    rest_alerts: list[RestAlert] | None = None

    def to_dict(self) -> dict:
        return {
            "findings": [asdict(item) for item in self.findings],
            "rehearsal_letters": self.rehearsal_letters,
            "suggestions": self.suggestions,
            "rhythm_info": self.rhythm_info.to_dict() if self.rhythm_info else None,
            "complex_markings": [m.to_dict() for m in (self.complex_markings or [])],
            "rest_alerts": [r.to_dict() for r in (self.rest_alerts or [])],
        }


def _decode(data: bytes) -> str:
    return data.decode("utf-8", errors="ignore")


def _strip_xml(text: str) -> str:
    return re.sub(r"<[^>]+>", "", text or "").strip()


def _extract_time_signatures(text: str) -> str:
    """Extract first time signature found in the score."""
    match = re.search(r'<time>\s*<beats>(\d+)</beats>\s*<beat-type>(\d+)</beat-type>', text)
    if match:
        return f"{match.group(1)}/{match.group(2)}"
    return "4/4"  # Default


def _extract_tempo(text: str) -> int | None:
    """Extract tempo in BPM from metronome or sound element."""
    # Try metronome first
    match = re.search(r'<metronome>\s*(?:<beat-unit>[^<]+</beat-unit>)?\s*<per-minute>(\d+)</per-minute>', text, re.S)
    if match:
        return int(match.group(1))
    # Try sound tempo attribute
    match = re.search(r'<sound[^>]*tempo="([^"]+)"', text)
    if match:
        try:
            return int(float(match.group(1)))
        except ValueError:
            pass
    return None


def _extract_rhythm_info(text: str) -> RhythmInfo:
    """Extract rhythm complexity, note/rest counts, and time signature."""
    time_sig = _extract_time_signatures(text)
    tempo_bpm = _extract_tempo(text)
    
    # Count notes and rests
    note_count = len(re.findall(r'<note\b', text))
    rest_count = len(re.findall(r'<rest\b', text))
    
    # Find complex rhythms (tuplets, syncopation patterns)
    complex_rhythms = []
    if re.search(r'<tuplet\b', text):
        complex_rhythms.append("tuplets")
    if re.search(r'<beam\b', text):
        complex_rhythms.append("beamed_figures")
    if re.search(r'<tied\b', text):
        complex_rhythms.append("tied_notes")
    if re.search(r'<dot/>', text):
        complex_rhythms.append("dotted_rhythms")
    if re.search(r'<type>(?:whole|breve)</type>', text):
        complex_rhythms.append("long_note_values")
    
    return RhythmInfo(
        time_signature=time_sig,
        tempo_bpm=tempo_bpm,
        note_count=note_count,
        rest_count=rest_count,
        complex_rhythms=complex_rhythms,
    )


def _extract_complex_markings(text: str) -> list[MarkingInfo]:
    """Extract articulations, accents, and other complex performance markings."""
    markings = []
    measure_pattern = r'<measure\b[^>]*number="([^"]*)"[^>]*>(.*?)</measure>'
    
    for measure_match in re.finditer(measure_pattern, text, re.S):
        measure_num = measure_match.group(1)
        measure_body = measure_match.group(2)
        
        # Extract articulations
        for articulation in re.finditer(r'<articulations>\s*(.*?)\s*</articulations>', measure_body, re.S):
            articulation_body = articulation.group(1)
            if '<accent/>' in articulation_body:
                markings.append(MarkingInfo(int(measure_num) if measure_num.isdigit() else 1, "accent", "accent"))
            if '<staccato/>' in articulation_body:
                markings.append(MarkingInfo(int(measure_num) if measure_num.isdigit() else 1, "articulation", "staccato"))
            if '<tenuto/>' in articulation_body:
                markings.append(MarkingInfo(int(measure_num) if measure_num.isdigit() else 1, "articulation", "tenuto"))
            if '<marcato/>' in articulation_body:
                markings.append(MarkingInfo(int(measure_num) if measure_num.isdigit() else 1, "articulation", "marcato"))
        
        # Extract rests (for alert system)
        for rest_match in re.finditer(r'<rest\b', measure_body):
            markings.append(MarkingInfo(int(measure_num) if measure_num.isdigit() else 1, "rest", "rest"))
        
        # Extract fermatas
        if '<fermata' in measure_body:
            markings.append(MarkingInfo(int(measure_num) if measure_num.isdigit() else 1, "fermata", "fermata"))
        
        # Extract trills and ornaments
        if '<trill-mark' in measure_body:
            markings.append(MarkingInfo(int(measure_num) if measure_num.isdigit() else 1, "ornament", "trill"))
        if '<turn' in measure_body:
            markings.append(MarkingInfo(int(measure_num) if measure_num.isdigit() else 1, "ornament", "turn"))
        if '<mordent' in measure_body:
            markings.append(MarkingInfo(int(measure_num) if measure_num.isdigit() else 1, "ornament", "mordent"))
    
    return markings



def _extract_rest_alerts(text: str) -> list[RestAlert]:
    """Extract rest positions with timing for alert system."""
    alerts = []
    measure_pattern = r'<measure\b[^>]*number="([^"]*)"[^>]*>(.*?)</measure>'
    
    for measure_match in re.finditer(measure_pattern, text, re.S):
        measure_num = int(measure_match.group(1)) if measure_match.group(1).isdigit() else 1
        measure_body = measure_match.group(2)
        
        # Track current beat position in measure
        current_beat = 0.0
        
        # Find all notes and rests in order
        note_pattern = r'<note\b[^>]*>(.*?)</note>'
        for note_match in re.finditer(note_pattern, measure_body, re.S):
            note_body = note_match.group(1)
            
            # Check if it's a rest
            if '<rest' in note_body:
                # Extract duration
                duration_match = re.search(r'<duration>(\d+)</duration>', note_body)
                if duration_match:
                    duration = int(duration_match.group(1))
                    # Convert to beats (assuming quarter note = 1 beat, this is simplified)
                    duration_beats = duration / 4.0  # This needs refinement based on divisions
                    
                    # Extract rest type
                    type_match = re.search(r'<type>([^<]+)</type>', note_body)
                    rest_type = type_match.group(1) if type_match else "rest"
                    
                    # Calculate alert timing (2 beats before rest ends)
                    alert_at_beats = current_beat + duration_beats - 2.0
                    if alert_at_beats > current_beat:  # Only if rest is long enough
                        alerts.append(RestAlert(
                            measure=measure_num,
                            beat=current_beat,
                            duration_beats=duration_beats,
                            alert_at_beats=max(current_beat, alert_at_beats),
                            rest_type=rest_type
                        ))
            
            # Update beat position (simplified - assumes quarter note divisions)
            duration_match = re.search(r'<duration>(\d+)</duration>', note_body)
            if duration_match:
                current_beat += int(duration_match.group(1)) / 4.0
    
    return alerts


def _extract_rehearsal_letters(text: str) -> list[dict]:
    letters: list[dict] = []
    measures = list(re.finditer(r'<measure\b[^>]*number="([^"]*)"[^>]*>(.*?)</measure>', text, re.S))
    for index, match in enumerate(measures):
      body = match.group(2)
      rehearsal = re.search(r"<rehearsal[^>]*>(.*?)</rehearsal>", body, re.S)
      boxed = re.search(r'<words[^>]*(?:enclosure="(?:square|rectangle|box)"|font-weight="bold")[^>]*>(.*?)</words>', body, re.S)
      label = _strip_xml((rehearsal or boxed).group(1)) if rehearsal or boxed else ""
      if label:
          letters.append({
              "label": label,
              "measure": match.group(1) or str(index + 1),
              "measure_index": index,
              "source": "score" if rehearsal else "text",
          })
    if letters or not measures:
        return letters
    interval = 16 if len(measures) >= 48 else 8
    for auto_index, match in enumerate(measures[::interval]):
        letters.append({
            "label": chr(65 + (auto_index % 26)),
            "measure": match.group(1) or str(auto_index * interval + 1),
            "measure_index": auto_index * interval,
            "source": "auto",
        })
    return letters


def analyze_musicxml(data: bytes) -> StyleReport:
    text = _decode(data)
    findings: list[StyleFinding] = []
    dynamics = re.findall(r"<dynamics[^>]*>.*?</dynamics>", text, re.S)
    if dynamics:
        findings.append(StyleFinding("Dynamics", len(dynamics), "p, f, mf, and related dynamic markings"))
    slurs = len(re.findall(r"<slur\b", text))
    if slurs:
        findings.append(StyleFinding("Slurs/Phrases", slurs, "Legato and phrase connections"))
    words = re.findall(r"<words[^>]*>(.*?)</words>", text, re.S)
    if words:
        findings.append(StyleFinding("Text Markings", len(words), ", ".join(_strip_xml(w) for w in words[:3])))
    tempo = re.findall(r"<metronome\b.*?</metronome>|<sound[^>]*tempo=", text, re.S)
    if tempo:
        findings.append(StyleFinding("Tempo Marks", len(tempo), "Metronome or sound tempo markings"))
    hairpins = len(re.findall(r"<wedge\b", text))
    if hairpins:
        findings.append(StyleFinding("Hairpins", hairpins, "Crescendo and decrescendo wedges"))

    suggestions: list[dict] = []
    if not dynamics:
        suggestions.append({"type": "Stylistic", "title": "Shape phrase dynamics", "detail": "No dynamics were found."})
    if not slurs:
        suggestions.append({"type": "Stylistic", "title": "Add phrasing intent", "detail": "No slurs were found."})
    if not tempo:
        suggestions.append({"type": "Stylistic", "title": "Confirm tempo reference", "detail": "No explicit metronome mark was detected."})

    # Extract rhythm and complex marking information
    rhythm_info = _extract_rhythm_info(text)
    complex_markings = _extract_complex_markings(text)
    rest_alerts = _extract_rest_alerts(text)

    return StyleReport(
        findings=findings,
        rehearsal_letters=_extract_rehearsal_letters(text),
        suggestions=suggestions,
        rhythm_info=rhythm_info,
        complex_markings=complex_markings if complex_markings else None,
        rest_alerts=rest_alerts if rest_alerts else None,
    )
