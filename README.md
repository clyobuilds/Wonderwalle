# Wonderwalle

A 4x4 grid of sixteen pads in the browser. Click a pad and your browser speaks its phrase
aloud. The sixteenth pad stops everything.

There are no audio files in this project. Every sound is synthesized on the fly by
`window.speechSynthesis`, the speech engine already built into your browser. Nothing is
uploaded, nothing is downloaded, and nothing you type ever reaches a server.

Wonderwall plus Wall-E, hence the extra E.

## Using it

- **Pads 1 to 15** each display one phrase and are the speak trigger, like a physical pad
  controller: click anywhere on a pad to hear its phrase. Clicking a pad that is already
  speaking restarts it from the beginning. Empty pads are drawn with a dashed outline and
  do nothing when clicked.
- **Pad 16, Stop All**, cancels any speech in progress.
- **Load all is the only way to change a pad's phrase.** Paste one phrase per line into the
  box and press Load all. Lines fill pads 1 to 15 by position; a blank line in the middle
  clears that pad; anything past line 15 is dropped with a note. It overwrites, so it asks
  first. To edit a single pad, use Copy all to pull the current set into the box, change
  the line you want, and Load all again.
- **Copy all** copies your set as one phrase per line, ready to paste straight back into
  Load all or send to someone else.
- **Clear all** empties every pad, after a confirm step.
- Your set is saved to `localStorage`, so a refresh brings it back.

### Theme

The button in the top right cycles **Auto → Light → Dark → Auto**. Auto follows your OS's
light/dark setting automatically; Light and Dark pin an explicit choice regardless of what
your system is set to. Your choice is remembered across visits.

Phrases are split on line breaks, never on commas, so a phrase can contain as many commas
as it likes without being torn into separate pads.

### Keyboard

| Pads 1-4 | Pads 5-8 | Pads 9-12 | Pads 13-15 | Stop All |
|----------|----------|-----------|------------|----------|
| 1 2 3 4  | Q W E R  | A S D F   | Z X C      | V        |

Shortcuts are ignored while you are typing in any text field, including the Load all box.

## Voices

Wonderwalle picks a voice for you. There is no voice picker.

- On **Linux**, the preferred voice is **Fred**.
- On **macOS, Windows, iOS, Android, and anything else**, the preferred voice is
  **Daniel**.

The operating system is detected from `navigator.userAgent` on a best-effort basis.
Android is deliberately excluded from the Linux branch, since Android user agents also
contain the word "Linux".

Once the browser has finished loading its voice list, Wonderwalle looks for an exact,
case-insensitive match on the preferred name and uses it for every pad. If that voice is
not installed on your device, it falls back silently: first to whichever voice the browser
marks as its default, then to the first voice available. There is no error, no banner, and
no prompt. It simply sounds different.

One quirk worth knowing: `speechSynthesis.getVoices()` usually returns an empty array the
very first time it is called, because browsers load the voice list asynchronously.
Wonderwalle never reads a cold empty result as "that voice is missing". It reads the list
again when the browser's `voiceschanged` event fires, and again at the moment you press a
pad.

Speech synthesis needs a browser that supports the Web Speech API. Without it, the pads
still load and save, but they will not speak.

## Files

```
index.html    markup
styles.css    styling
app.js        behavior
qa/check.mjs  Playwright checks (development only)
```

No frameworks, no build step, and no dependencies in the shipped app. Open `index.html`
and it runs.

One caveat when opening the file directly from disk over `file://`: the Clipboard API is
only available in a secure context, so Copy all cannot write to your clipboard there.
Wonderwalle detects this and shows a pre-selected text box you can copy by hand instead.
Served over `https` (as on GitHub Pages) or from `localhost`, Copy all works normally.

## Development

The app needs nothing installed. The QA script does:

```bash
npm install && npx playwright install chromium
```

Then:

```bash
npm run qa
```

The script serves the folder over `http://127.0.0.1`, drives it in headless Chromium, and
checks pad rendering, the theme toggle, persistence across reload, the keyboard guard
against typing in the Load all box, whole-pad click-to-speak, the empty-voice-list
fallback, bulk load ordering and line-ending handling, comma safety, the Copy all round
trip, and the disabled-button states. It also documents one known limitation: a genuinely
blank pad 1 can't round-trip through Copy all / Load all, since the parser can't tell a
real blank first line from an incidental one and always trims it. It writes a screenshot to
`qa/preview.png`.

## License

MIT. See [LICENSE](LICENSE).
