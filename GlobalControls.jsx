import React, { useEffect, useState } from 'react';
import ThemeToggle from './ThemeToggle.jsx';
import ShareButton from './ShareButton.jsx';

export default function GlobalControls() {
  const isSharedPage = /^\/shared\//.test(window.location.pathname);
  const [isLoggedIn, setIsLoggedIn] = useState(false);

  useEffect(() => {
    // Only show the share button when the user has an active session.
    fetch('/auth/me', { credentials: 'include' })
      .then(r => setIsLoggedIn(r.ok))
      .catch(() => setIsLoggedIn(false));
  }, []);

  if (isSharedPage) {
    return null;
  }

  return (
    <div
      style={{
        position: 'fixed',
        top: 12,
        right: 12,
        zIndex: 10000,
        display: 'flex',
        gap: 8,
        alignItems: 'center',
        padding: '8px 12px',
        borderRadius: 9999,
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        boxShadow: '0 4px 12px rgba(0,0,0,0.12)',
      }}
    >
      <ThemeToggle />
      {isLoggedIn && <ShareButton />}
    </div>
  );
}
