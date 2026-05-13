export async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return true;
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();

  let success = false;
  try {
    success = document.execCommand('copy');
  } finally {
    document.body.removeChild(textarea);
  }

  return success;
}

export async function shareUrl(url, title = 'ScoreSync') {
  if (navigator.share) {
    try {
      await navigator.share({ title, url });
      return true;
    } catch {
      // User cancelled or unsupported.
    }
  }
  return false;
}

export function supportsSpeechRecognition() {
  return Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);
}

export function getAudioContext() {
  return window.AudioContext || window.webkitAudioContext || null;
}
