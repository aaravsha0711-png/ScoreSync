export const SUPPORTED_SCORE_TYPES = ".pdf,.xml,.musicxml,.mxl,.mscz,.mscx";

export function detectScoreType(file) {
  const ext = file.name.split(".").pop()?.toLowerCase();
  if (ext === "pdf") return "pdf";
  if (["xml", "musicxml", "mxl"].includes(ext)) return "musicxml";
  if (["mscz", "mscx"].includes(ext)) return "musescore";
  return "unknown";
}

export async function loadScoreFile(file) {
  const type = detectScoreType(file);

  if (type === "pdf") {
    return {
      score: URL.createObjectURL(file),
      scoreType: "pdf",
    };
  }

  if (type === "musicxml") {
    const text = await file.text();
    return {
      score: text,
      scoreType: "musicxml",
      xmlText: text,
    };
  }

  if (type === "musescore") {
    return {
      score: null,
      scoreType: "musescore",
    };
  }

  throw new Error(`Supported: ${SUPPORTED_SCORE_TYPES}`);
}
