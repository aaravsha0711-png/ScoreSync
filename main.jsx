import React from "react";
import { createRoot } from "react-dom/client";
import App from "./score-reader.jsx";
import { ThemeProvider } from "./theme.jsx";
import "./theme.css";

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </React.StrictMode>
);
