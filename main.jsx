import React from "react";
import { createRoot } from "react-dom/client";
import App from "./score-reader.jsx";
import SharedScorePage from "./SharedScorePage.jsx";
import GlobalControls from "./GlobalControls.jsx";
import { ThemeProvider } from "./theme.jsx";
import "./theme.css";

function MetricCard({ label, value, detail, accent = "var(--accent)" }) {
  return (
    <div
      className="glass"
      style={{
        padding: "18px",
        background: "linear-gradient(145deg, rgba(255,255,255,0.08), rgba(255,255,255,0.035))",
        position: "relative",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: "auto -30px -42px auto",
          width: "110px",
          height: "110px",
          borderRadius: "999px",
          background: accent,
          opacity: 0.12,
          filter: "blur(8px)",
        }}
      />
      <div style={{ color: "var(--text-muted)", fontSize: "0.82rem", marginBottom: 8 }}>
        {label}
      </div>
      <div style={{ fontSize: "1.75rem", fontWeight: 800, letterSpacing: "-0.04em" }}>
        {value}
      </div>
      <div style={{ color: "var(--text-muted)", fontSize: "0.85rem", marginTop: 4 }}>
        {detail}
      </div>
    </div>
  );
}

function DashboardOverview() {
  const waveformBars = [32, 56, 42, 70, 48, 84, 40, 64, 52, 78, 45, 58, 36, 66, 50, 72];

  return (
    <section style={{ display: "grid", gap: 16, marginBottom: 18 }}>
      <div
        className="glass"
        style={{
          padding: "24px",
          display: "grid",
          gridTemplateColumns: "minmax(0, 1.5fr) minmax(280px, 0.8fr)",
          gap: "20px",
          alignItems: "stretch",
          background:
            "linear-gradient(135deg, rgba(0,217,255,0.12), rgba(139,92,246,0.10) 45%, rgba(255,255,255,0.04))",
          overflow: "hidden",
          position: "relative",
        }}
      >
        <div style={{ position: "relative", zIndex: 1 }}>
          <div
            style={{
              color: "var(--accent)",
              fontSize: "0.75rem",
              letterSpacing: "0.22em",
              textTransform: "uppercase",
              fontWeight: 800,
              marginBottom: 10,
            }}
          >
            Practice Command Center
          </div>
          <h1 style={{ margin: 0, fontSize: "clamp(2rem, 4vw, 4rem)", lineHeight: 1 }}>
            Tune the room. Track the score. Own the rehearsal.
          </h1>
          <p style={{ color: "var(--text-muted)", maxWidth: 680, fontSize: "1.02rem" }}>
            A studio-grade dashboard for score uploads, calibration, playback, and performance intelligence.
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 18 }}>
            <button>Upload Score</button>
            <button style={{ background: "var(--surface-strong)", color: "var(--text)", border: "1px solid var(--border)" }}>
              Start Practice
            </button>
            <button style={{ background: "rgba(16,185,129,0.16)", color: "var(--success)", border: "1px solid rgba(16,185,129,0.3)" }}>
              Calibrate Mic
            </button>
          </div>
        </div>

        <div
          className="glass"
          style={{
            padding: 18,
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            minHeight: 210,
          }}
        >
          <div>
            <div style={{ color: "var(--text-muted)", fontSize: "0.82rem" }}>Live Session Spectrum</div>
            <div style={{ fontWeight: 800, fontSize: "1.2rem" }}>Ready for input</div>
          </div>
          <div style={{ display: "flex", alignItems: "end", gap: 6, height: 92 }}>
            {waveformBars.map((height, index) => (
              <div
                key={index}
                style={{
                  flex: 1,
                  height: `${height}%`,
                  minWidth: 5,
                  borderRadius: 999,
                  background:
                    "linear-gradient(180deg, var(--accent), var(--accent-2))",
                  opacity: 0.72,
                  boxShadow: "0 0 18px rgba(0,217,255,0.18)",
                }}
              />
            ))}
          </div>
          <div style={{ color: "var(--text-muted)", fontSize: "0.78rem" }}>
            Visual monitor reserved for live pitch, volume, and timing data.
          </div>
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, minmax(160px, 1fr))",
          gap: 14,
        }}
      >
        <MetricCard label="Practice Streak" value="7d" detail="Momentum building" accent="var(--accent)" />
        <MetricCard label="Tempo Target" value="120" detail="BPM default" accent="var(--warning)" />
        <MetricCard label="Calibration" value="C" detail="Concert pitch" accent="var(--success)" />
        <MetricCard label="Workspace" value="Live" detail="Studio shell active" accent="var(--accent-2)" />
      </div>
    </section>
  );
}

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

        <DashboardOverview />

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
