import React from "react";
import { createRoot } from "react-dom/client";
import App from "./score-reader.jsx";
import SharedScorePage from "./SharedScorePage.jsx";
import { ThemeProvider } from "./theme.jsx";
import "./theme.css";

function Root() {
  const match = window.location.pathname.match(/^\/shared\/([^/]+)$/);
  if (match) {
    return <SharedScorePage token={match[1]} />;
  }
  return <App />;
}

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <ThemeProvider>
      <Root />
    </ThemeProvider>
  </React.StrictMode>
);
