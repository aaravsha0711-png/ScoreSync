# Score Reader Modular Architecture

The original `score-reader.jsx` remains the canonical implementation.

This directory now contains reusable modules that mirror the intended split:

- `App.jsx` – modular entry point
- `index.js` – package-style export
- `lib/api.js` – API helpers and upload persistence
- `lib/fileHandlers.js` – PDF and MusicXML loading utilities
- `components/AuthScreen.jsx`
- `components/InstrumentScreen.jsx`
- `components/CalibrationScreen.jsx`
- `components/MainScreen.jsx`

## Preserved Behavior

The following behavior remains unchanged in the original implementation:

- PDF rendering through an iframe/object URL
- MusicXML rendering through OpenSheetMusicDisplay
- Upload persistence to `/scores/upload`
- Authentication and profile management
- Instrument selection and calibration
- Practice and analysis features
- Sticky notes and annotations

## Next Refactor Stage

The current modules provide a stable structure and extracted utilities. The original `score-reader.jsx` can now be incrementally updated to import from these modules without changing runtime behavior.
