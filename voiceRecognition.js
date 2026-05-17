// voiceRecognition.js — Voice recognition helpers

export function startVoiceRecognition(onMeasureJump, onWakeWord) {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) return null;

  const recognition = new SpeechRecognition();
  recognition.continuous = true;
  recognition.interimResults = false;
  recognition.lang = "en-US";
  let _stopped = false;

  recognition.onresult = (event) => {
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const transcript = event.results[i][0].transcript.toLowerCase().trim();

      const measureMatch = transcript.match(/(?:measure|go to|jump to)\s+(\d+)/);
      if (measureMatch) {
        const measureNum = parseInt(measureMatch[1]);
        if (!isNaN(measureNum)) {
          onMeasureJump(measureNum);
          return;
        }
      }

      const resumeMatch = transcript.match(/(?:resume|take it from|start from)\s*(\d+)?/);
      if (resumeMatch) {
        const measureNum = resumeMatch[1] ? parseInt(resumeMatch[1]) : 1;
        onWakeWord(isNaN(measureNum) ? 1 : measureNum);
        return;
      }
    }
  };

  recognition.onerror = (e) => {
    // Ignore no-speech errors; stop on fatal errors to avoid restart loops
    if (e.error === "not-allowed" || e.error === "service-not-allowed") _stopped = true;
  };
  recognition.onend = () => {
    if (!_stopped) { try { recognition.start(); } catch (_) {} }
  };

  try { recognition.start(); } catch (_) {}

  // Return a handle so the caller can stop cleanly without triggering restart
  return {
    stop() { _stopped = true; try { recognition.stop(); } catch (_) {} },
    recognition,
  };
}
