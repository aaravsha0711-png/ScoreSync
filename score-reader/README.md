# Modular Original Score Reader

This directory provides a modular entry point for the original score reader.

- `App.jsx` re-exports `score-reader.jsx`.
- `index.js` re-exports `App.jsx`.

This keeps the original design and behavior intact. The only PDF and MusicXML rendering changes remain those already implemented in `score-reader-functional.jsx` and whichever component imports are directed to use.

Example usage:

```js
import App from './score-reader';
```

or:

```js
import App from './score-reader/App.jsx';
```
