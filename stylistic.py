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
class StyleReport:
    findings: list[StyleFinding]
    rehearsal_letters: list[dict]
    suggestions: list[dict]

    def to_dict(self) -> dict:
        return {
            "findings": [asdict(item) for item in self.findings],
            "rehearsal_letters": self.rehearsal_letters,
            "suggestions": self.suggestions,
        }


def _decode(data: bytes) -> str:
    return data.decode("utf-8", errors="ignore")


def _strip_xml(text: str) -> str:
    return re.sub(r"<[^>]+>", "", text or "").strip()


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

    return StyleReport(
        findings=findings,
        rehearsal_letters=_extract_rehearsal_letters(text),
        suggestions=suggestions,
    )
