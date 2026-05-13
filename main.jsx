import React from "react";
import { createRoot } from "react-dom/client";
import App from "./score-reader.jsx";
import SharedScorePage from "./SharedScorePage.jsx";
import GlobalControls from "./GlobalControls.jsx";
import { ThemeProvider } from "./theme.jsx";
import "./theme.css";

function StudioShell({ children }) {
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "grid",
        gridTemplateColumns: "260px 1fr",
        gap: "16px",
        padding: "16px",
      }}
    >
      <aside
        className="glass"
        style={{
          padding: "24px",
          display: "flex",
          flexDirection: "column",
          gap: "20px",
          position: "sticky",
          top: "16px",
          height: "calc(100vh - 32px)",
        }}
      >
        <div>
          <div
            style={{
              fontSize: "0.75rem",
              letterSpacing: "0.18em",
              textTransform: "uppercase",
              color: "var(--text-muted)",
              marginBottom: "8px",
            }}
          >
            Digital Music Studio
          </div>
          <div
            style={{
              fontSize: "2rem",
              fontWeight: 800,
              letterSpacing: "-0.03em",
            }}
          >
            ScoreSync
          </div>
        </div>

        <div
          className="glass"
          style={{
            padding: "16px",
            background: "var(--surface-strong)",
          }}
        >
          <div style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>
            Practice Streak
          </div>
          <div style={{ fontSize: "1.75rem", fontWeight: 700 }}>7 Days</div>
        </div>

        <nav style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          {[
            ["🎼", "Scores"],
            ["🎧", "Practice"],
            ["🎛️", "Calibration"],
            ["📈", "Progress"],
          ].map(([icon, label]) => (
            <div
              key={label}
              style={{
                padding: "12px 14px",
                borderRadius: "14px",
                background: "rgba(255,255,255,0.03)",
                border: "1px solid rgba(255,255,255,0.06)",
                display: "flex",
                alignItems: "center",
                gap: "10px",
                fontWeight: 600,
              }}
            >
              <span>{icon}</span>
              <span>{label}</span>
            </div>
          ))}
        </nav>

        <div
          style={{
            marginTop: "auto",
            fontSize: "0.85rem",
            color: "var(--text-muted)",
          }}
        >
          Synced and ready.
        </div>
      </aside>

      <main style={{ minWidth: 0 }}>
        <header
          className="glass"
          style={{
            padding: "14px 20px",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "16px",
          }}
        >
          <div>
            <div style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>
              Workspace
            </div>
            <div style={{ fontWeight: 700 }}>Professional Practice Environment</div>
          </div>
          <div
            style={{
              padding: "6px 12px",
              borderRadius: "999px",
              background: "rgba(16,185,129,0.12)",
              color: "var(--success)",
              fontWeight: 700,
              fontSize: "0.85rem",
            }}
          >
            ● Live
          </div>
        </header>

        <div
          className="glass"
          style={{
            padding: "20px",
            minHeight: "calc(100vh - 120px)",
          }}
        >
          {children}
        </div>
      </main>
    </div>
  );
}

function Root() {
  const match = window.location.pathname.match(/^\/shared\/([^/]+)$/);
  if (match) {
    return <SharedScorePage token={match[1]} />;
  }

  return (
    <StudioShell>
      <App />
    </StudioShell>
  );
}

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <ThemeProvider>
      <GlobalControls />
      <Root />
    </ThemeProvider>
  </React.StrictMode>
);
