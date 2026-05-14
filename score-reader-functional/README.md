# Modular Score Reader Entry

This directory provides a modular entry point for the score reader.

- `App.jsx` re-exports the existing `score-reader-functional.jsx` component.
- `index.js` re-exports `App.jsx`.

This preserves all existing functionality, including:
- PDF rendering in an iframe
- MusicXML rendering with OpenSheetMusicDisplay
- Upload persistence to `/scores/upload`
- Authentication
- Sticky notes
- Practice mode and microphone pitch detection

You can update imports to use:

```js
import App from './score-reader-functional';
```

or:

```js
import App from './score-reader-functional/App.jsx';
```

without changing behavior.
