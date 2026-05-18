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
    return (
      <div style={{ padding: 24, fontFamily: 'Georgia, serif', color: '#e8d9b0', background: '#0e0c09', minHeight: '100vh' }}>
        <h2 style={{ color: '#ee5555' }}>Unable to load score</h2>
        <p>{error}</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div style={{ padding: 24, fontFamily: 'Georgia, serif', color: '#a89060', background: '#0e0c09', minHeight: '100vh' }}>
        Loading shared score…
      </div>
    );
  }

  // The /sharing/:token endpoint is public (no auth required).
  // Build a download URL that re-uses the same public token route.
  // We ask the browser to download via a dedicated streaming endpoint.
  const downloadUrl = `/sharing/${token}/download`;

  return (
    <div style={{ padding: 24, fontFamily: 'Georgia, serif', color: '#e8d9b0', background: '#0e0c09', minHeight: '100vh' }}>
      <div style={{ maxWidth: 600, margin: '0 auto' }}>
        <div style={{ color: '#C9A84C', fontSize: '0.75rem', letterSpacing: '0.2em', textTransform: 'uppercase', marginBottom: 8 }}>
          Shared via ScoreSync
        </div>
        <h1 style={{ margin: '0 0 8px', color: '#e8d9b0' }}>{data.filename}</h1>
        <p style={{ color: '#a89060', fontSize: 14 }}>
          File type: <strong style={{ color: '#C9A84C' }}>{data.file_type?.toUpperCase()}</strong>
        </p>
        <a
          href={downloadUrl}
          download={data.filename}
          style={{
            display: 'inline-block',
            marginTop: 16,
            background: '#C9A84C',
            color: '#1a1200',
            padding: '10px 20px',
            borderRadius: 8,
            fontWeight: 700,
            textDecoration: 'none',
            fontSize: 14,
          }}
        >
          Download Score
        </a>
        <p style={{ color: '#554030', fontSize: 12, marginTop: 16 }}>
          Open this file in your notation software or upload it to ScoreSync for practice.
        </p>
      </div>
    </div>
  );
}
