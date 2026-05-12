import React, { useState } from 'react';
import { copyText, shareUrl } from './browserCompat.js';

async function apiRequest(path, options = {}) {
  const response = await fetch(path, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  });

  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;

  if (!response.ok) {
    throw new Error(payload?.detail || payload?.message || response.statusText);
  }

  return payload;
}

export default function ShareButton({ scoreId }) {
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  if (!scoreId) return null;

  const handleShare = async () => {
    setLoading(true);
    setMessage('');

    try {
      const result = await apiRequest(`/sharing/scores/${scoreId}`, {
        method: 'POST',
        body: JSON.stringify({ expires_in_days: 30 }),
      });

      const url = new URL(result.url, window.location.origin).toString();

      const shared = await shareUrl(url, 'Shared ScoreSync Score');
      if (!shared) {
        await copyText(url);
        setMessage('Share link copied to clipboard.');
      } else {
        setMessage('Share link sent.');
      }
    } catch (error) {
      setMessage(error.message || 'Unable to create share link.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      <button type="button" onClick={handleShare} disabled={loading}>
        {loading ? 'Sharing…' : 'Share'}
      </button>
      {message && <span style={{ fontSize: 12, opacity: 0.8 }}>{message}</span>}
    </div>
  );
}
