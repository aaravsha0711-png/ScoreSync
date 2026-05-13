import React, { useEffect, useState } from 'react';

export default function SharedScorePage({ token }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch(`/sharing/${token}`)
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload?.detail || 'Unable to load shared score.');
        setData(payload);
      })
      .catch((err) => setError(err.message || 'Unable to load shared score.'));
  }, [token]);

  if (error) {
    return <div style={{ padding: 24 }}>Error: {error}</div>;
  }

  if (!data) {
    return <div style={{ padding: 24 }}>Loading shared score…</div>;
  }

  return (
    <div style={{ padding: 24 }}>
      <h1>{data.filename}</h1>
      <p>Shared via ScoreSync</p>
      <a href={data.stored_path} target="_blank" rel="noreferrer">
        Open Score File
      </a>
    </div>
  );
}
