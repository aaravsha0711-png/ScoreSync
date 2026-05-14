import React from "react";
import { createRoot } from "react-dom/client";
import App from "./score-reader.jsx";
import SharedScorePage from "./SharedScorePage.jsx";
import GlobalControls from "./GlobalControls.jsx";
import { ThemeProvider } from "./theme.jsx";
import "./theme.css";

function MetricCard({ label, value, detail, accent = "var(--accent)" }) {
  return (
    <div className="glass" style={{ padding: 18, position: "relative", overflow: "hidden" }}>
      <div style={{ position: "absolute", inset: "auto -30px -42px auto", width: 110, height: 110, borderRadius: 999, background: accent, opacity: 0.12, filter: "blur(8px)" }} />
      <div style={{ color: "var(--text-muted)", fontSize: "0.82rem", marginBottom: 8 }}>{label}</div>
      <div style={{ fontSize: "1.75rem", fontWeight: 800 }}>{value}</div>
      <div style={{ color: "var(--text-muted)", fontSize: "0.85rem", marginTop: 4 }}>{detail}</div>
    </div>
  );
}

function DashboardOverview() {
  const waveformBars = [32, 56, 42, 70, 48, 84, 40, 64, 52, 78, 45, 58, 36, 66, 50, 72];
  const scrollToWorkspace = () => document.getElementById("scoresync-workspace")?.scrollIntoView({ behavior: "smooth", block: "start" });

  const clickFirst = (selectors) => {
    for (const selector of selectors) {
      const el = document.querySelector(selector);
      if (el) {
        el.click();
        scrollToWorkspace();
        return;
      }
    }
    scrollToWorkspace();
  };

  return (
    <section style={{ display: "grid", gap: 16, marginBottom: 18 }}>
      <div className="glass" style={{ padding: 24, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 20 }}>
        <div>
          <div style={{ color: "var(--accent)", fontSize: "0.75rem", letterSpacing: "0.22em", textTransform: "uppercase", fontWeight: 800, marginBottom: 10 }}>
            Practice Command Center
          </div>
          <h1 style={{ margin: 0, fontSize: "clamp(2rem, 4vw, 4rem)", lineHeight: 1 }}>Tune the room. Track the score. Own the rehearsal.</h1>
          <p style={{ color: "var(--text-muted)", maxWidth: 680 }}>
            A studio-grade dashboard for score uploads, calibration, playback, and performance intelligence.
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 18 }}>
            <button onClick={() => clickFirst(['input[type="file"]'])}>Upload Score</button>
            <button
              onClick={() => clickFirst(['button[title*="play" i]', 'button[aria-label*="play" i]'])}
              style={{ background: "var(--surface-strong)", color: "var(--text)", border: "1px solid var(--border)" }}
            >
              Start Practice
            </button>
            <button
              onClick={() => clickFirst(['button[title*="calibrat" i]', 'button[title*="microphone" i]', 'button[aria-label*="calibrat" i]'])}
              style={{ background: "rgba(16,185,129,0.16)", color: "var(--success)", border: "1px solid rgba(16,185,129,0.3)" }}
            >
              Calibrate Mic
            </button>
          </div>
        </div>

        <div className="glass" style={{ padding: 18, display: "flex", flexDirection: "column", justifyContent: "space-between", minHeight: 210 }}>
          <div>
            <div style={{ color: "var(--text-muted)", fontSize: "0.82rem" }}>Live Session Spectrum</div>
            <div style={{ fontWeight: 800, fontSize: "1.2rem" }}>Ready for input</div>
          </div>
          <div style={{ display: "flex", alignItems: "end", gap: 6, height: 92 }}>
            {waveformBars.map((height, index) => (
              <div key={index} style={{ flex: 1, height: `${height}%`, minWidth: 5, borderRadius: 999, background: "linear-gradient(180deg, var(--accent), var(--accent-2))", opacity: 0.72 }} />
            ))}
          </div>
          <div style={{ color: "var(--text-muted)", fontSize: "0.78rem" }}>Visual monitor reserved for live pitch, volume, and timing data.</div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 14 }}>
        <MetricCard label="Practice Streak" value="7d" detail="Momentum building" />
        <MetricCard label="Tempo Target" value="120" detail="BPM default" accent="var(--warning)" />
        <MetricCard label="Calibration" value="C" detail="Concert pitch" accent="var(--success)" />
        <MetricCard label="Workspace" value="Live" detail="Studio shell active" accent="var(--accent-2)" />
      </div>
    </section>
  );
}

function BottomTabBar({ onMenu, onFullscreen }) {
  const tabStyle = {
    flex: 1,
    background: "transparent",
    border: "none",
    boxShadow: "none",
    padding: "8px 4px",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 4,
    color: "var(--text)",
    fontSize: "0.72rem",
    minHeight: 56,
  };

  const scrollTo = (id) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });

  return (
    <nav className="glass" style={{ position: "fixed", left: 12, right: 12, bottom: 12, zIndex: 1000, display: "flex", alignItems: "center", padding: 6, borderRadius: 24 }}>
      <button style={tabStyle} onClick={() => scrollTo("scoresync-dashboard")} aria-label="Dashboard">🏠<span>Home</span></button>
      <button style={tabStyle} onClick={() => scrollTo("scoresync-workspace")} aria-label="Scores">🎼<span>Score</span></button>
      <button
        style={tabStyle}
        onClick={() => {
          scrollTo("scoresync-workspace");
          document.querySelector('button[title*="play" i], button[aria-label*="play" i]')?.click();
        }}
        aria-label="Practice"
      >
        ▶️<span>Practice</span>
      </button>
      <button style={tabStyle} onClick={onFullscreen} aria-label="Full screen">⛶<span>Focus</span></button>
      <button style={tabStyle} onClick={onMenu} aria-label="Menu">☰<span>Menu</span></button>
    </nav>
  );
}

function StudioShell({ children }) {
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [isFullscreen, setIsFullscreen] = React.useState(false);

  React.useEffect(() => {
    const onChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const toggleFullscreen = async () => {
    const workspace = document.getElementById("scoresync-workspace");
    if (!workspace) return;
    if (document.fullscreenElement) {
      await document.exitFullscreen();
    } else {
      await workspace.requestFullscreen();
      workspace.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };

  return (
    <div style={{ minHeight: "100vh", display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 16, padding: isFullscreen ? 0 : 16, paddingBottom: isFullscreen ? 0 : 110 }}>
      {!isFullscreen && (
        <header className="glass" style={{ padding: "12px 16px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
          <div><div style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>Workspace</div><div style={{ fontWeight: 700 }}>Professional Practice Environment</div></div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={toggleFullscreen} style={{ minWidth: 44, minHeight: 44 }} aria-label="Enter full screen">⛶</button>
            <button onClick={() => setMenuOpen((v) => !v)} style={{ minWidth: 44, minHeight: 44 }} aria-label="Toggle menu">☰</button>
          </div>
        </header>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 16 }}>
        {!isFullscreen && menuOpen && (
          <aside className="glass" style={{ padding: 24, display: "flex", flexDirection: "column", gap: 20 }}>
            <div>
              <div style={{ fontSize: "0.75rem", letterSpacing: "0.18em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 8 }}>Digital Music Studio</div>
              <div style={{ fontSize: "2rem", fontWeight: 800 }}>ScoreSync</div>
            </div>
          </aside>
        )}

        <main style={{ minWidth: 0 }}>
          {!isFullscreen && <div id="scoresync-dashboard"><DashboardOverview /></div>}
          <div id="scoresync-workspace" className="glass" style={{ padding: 20, minHeight: isFullscreen ? "100vh" : "calc(100vh - 120px)", borderRadius: isFullscreen ? 0 : undefined }}>
            {isFullscreen && <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 12 }}><button onClick={toggleFullscreen} aria-label="Exit full screen">Exit Full Screen</button></div>}
            {children}
          </div>
        </main>
      </div>

      {!isFullscreen && <BottomTabBar onMenu={() => setMenuOpen((v) => !v)} onFullscreen={toggleFullscreen} />}
    </div>
  );
}

function Root() {
  const match = window.location.pathname.match(/^\/shared\/([^/]+)$/);
  if (match) return <SharedScorePage token={match[1]} />;
  return <StudioShell><App /></StudioShell>;
}

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <ThemeProvider>
      <GlobalControls />
      <Root />
    </ThemeProvider>
  </React.StrictMode>
);
