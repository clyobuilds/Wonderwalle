/* Wonderwalle - all behavior lives here.
   No network, no audio files: every sound is synthesized by window.speechSynthesis. */

(function () {
  'use strict';

  var PAD_COUNT = 15;
  var STORAGE_KEY = 'wonderwalle.phrases.v1';
  var THEME_KEY = 'wonderwalle.theme.v1';
  var THEME_ORDER = ['auto', 'light', 'dark'];
  var THEME_LABEL = { auto: 'Auto', light: 'Light', dark: 'Dark' };

  /* Pad 1..15 in grid order, then V for Stop All. */
  var PAD_KEYS = ['1', '2', '3', '4', 'q', 'w', 'e', 'r', 'a', 's', 'd', 'f', 'z', 'x', 'c'];
  var STOP_KEY = 'v';

  var synth = window.speechSynthesis || null;

  var phrases = new Array(PAD_COUNT).fill('');
  var voices = [];
  var currentUtterance = null;
  var playingPad = 0;
  var statusTimer = null;

  var grid = document.getElementById('grid');
  var bulk = document.getElementById('bulk');
  var loadAllBtn = document.getElementById('load-all');
  var loadConfirm = document.getElementById('load-confirm');
  var loadConfirmText = document.getElementById('load-confirm-text');
  var loadConfirmYes = document.getElementById('load-confirm-yes');
  var loadConfirmNo = document.getElementById('load-confirm-no');
  var copyAllBtn = document.getElementById('copy-all');
  var clearAllBtn = document.getElementById('clear-all');
  var clearConfirm = document.getElementById('clear-confirm');
  var clearConfirmYes = document.getElementById('clear-confirm-yes');
  var clearConfirmNo = document.getElementById('clear-confirm-no');
  var copyFallback = document.getElementById('copy-fallback');
  var copyFallbackText = document.getElementById('copy-fallback-text');
  var statusEl = document.getElementById('status');
  var unsupportedNote = document.getElementById('unsupported-note');
  var themeToggleBtn = document.getElementById('theme-toggle');

  /* ---------------- voices ----------------
     getVoices() commonly returns an empty array on the first call because the
     voice list loads asynchronously. Handle both cases: read whatever is there
     now, and read again when voiceschanged fires. An empty first read is never
     treated as "the voice is missing". */

  function refreshVoices() {
    try {
      voices = (synth && synth.getVoices()) || [];
    } catch (err) {
      voices = [];
    }
  }

  function preferredVoiceName() {
    var ua = (navigator && navigator.userAgent) || '';
    /* Android user agents also contain "Linux", so exclude them explicitly. */
    var isLinux = /Linux/i.test(ua) && !/Android/i.test(ua);
    return isLinux ? 'Fred' : 'Daniel';
  }

  function pickVoice() {
    if (!voices.length) refreshVoices();
    if (!voices.length) return null;

    var wanted = preferredVoiceName().toLowerCase();
    var i;
    for (i = 0; i < voices.length; i++) {
      if (voices[i] && String(voices[i].name || '').toLowerCase() === wanted) return voices[i];
    }
    /* Silent fallback: the browser default, else the first voice available. */
    for (i = 0; i < voices.length; i++) {
      if (voices[i] && voices[i]['default']) return voices[i];
    }
    return voices[0] || null;
  }

  if (synth) {
    refreshVoices();
    if (typeof synth.addEventListener === 'function') {
      synth.addEventListener('voiceschanged', refreshVoices);
    } else {
      synth.onvoiceschanged = refreshVoices;
    }
  } else if (unsupportedNote) {
    unsupportedNote.hidden = false;
  }

  /* ---------------- speaking ---------------- */

  function padEl(n) { return grid.querySelector('.pad[data-pad="' + n + '"]'); }
  function padInput(n) { return grid.querySelector('[data-pad-input="' + n + '"]'); }

  function setPlaying(n) {
    if (playingPad) {
      var prev = padEl(playingPad);
      if (prev) prev.classList.remove('is-playing');
    }
    playingPad = n;
    if (n) {
      var el = padEl(n);
      if (el) el.classList.add('is-playing');
    }
  }

  function speakPad(n) {
    var text = (phrases[n - 1] || '').trim();
    if (!text) return;          /* empty pads are inert */
    if (!synth) return;

    /* Clicking a pad that is already speaking cancels and restarts it. */
    try { synth.cancel(); } catch (err) { /* ignore */ }

    var utterance = new SpeechSynthesisUtterance(text);
    var voice = pickVoice();
    if (voice) {
      utterance.voice = voice;
      if (voice.lang) utterance.lang = voice.lang;
    }
    utterance.onend = function () { if (currentUtterance === utterance) setPlaying(0); };
    utterance.onerror = function () { if (currentUtterance === utterance) setPlaying(0); };

    currentUtterance = utterance;
    setPlaying(n);
    try {
      synth.speak(utterance);
    } catch (err) {
      currentUtterance = null;
      setPlaying(0);
    }
  }

  function stopAll() {
    if (synth) {
      try { synth.cancel(); } catch (err) { /* ignore */ }
    }
    currentUtterance = null;
    setPlaying(0);
  }

  /* ---------------- state ---------------- */

  function load() {
    var raw = null;
    try { raw = window.localStorage.getItem(STORAGE_KEY); } catch (err) { raw = null; }
    if (!raw) return;
    var saved;
    try { saved = JSON.parse(raw); } catch (err) { return; }
    if (!Array.isArray(saved)) return;
    for (var i = 0; i < PAD_COUNT; i++) {
      phrases[i] = typeof saved[i] === 'string' ? saved[i] : '';
    }
  }

  function save() {
    try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(phrases)); } catch (err) { /* ignore */ }
  }

  function renderPad(n) {
    var input = padInput(n);
    var el = padEl(n);
    if (input && input.value !== phrases[n - 1]) input.value = phrases[n - 1];
    if (el) el.classList.toggle('is-empty', !(phrases[n - 1] || '').trim());
  }

  function renderAll() {
    for (var n = 1; n <= PAD_COUNT; n++) renderPad(n);
    syncControls();
  }

  function allEmpty() {
    for (var i = 0; i < PAD_COUNT; i++) {
      if ((phrases[i] || '').trim()) return false;
    }
    return true;
  }

  function syncControls() {
    copyAllBtn.disabled = allEmpty();
    loadAllBtn.disabled = !bulk.value.trim();
  }

  function setStatus(message) {
    statusEl.textContent = message || '';
    if (statusTimer) clearTimeout(statusTimer);
    if (message) {
      statusTimer = setTimeout(function () { statusEl.textContent = ''; }, 5000);
    }
  }

  /* ---------------- bulk load ----------------
     Newline-delimited, never comma-delimited: phrases routinely contain commas,
     and splitting on them would break one phrase into several pads. */

  function parseBulk(raw) {
    var normalized = String(raw == null ? '' : raw).replace(/\r\n?/g, '\n');
    var lines = normalized.split('\n');
    /* Drop a single incidental blank line at each end (copy-paste artifacts).
       Interior blank lines are kept and deliberately clear that pad. */
    if (lines.length && !lines[0].trim()) lines.shift();
    if (lines.length && !lines[lines.length - 1].trim()) lines.pop();
    return lines.map(function (line) { return line.trim(); });
  }

  function hideConfirms() {
    loadConfirm.hidden = true;
    clearConfirm.hidden = true;
  }

  loadAllBtn.addEventListener('click', function () {
    var lines = parseBulk(bulk.value);
    if (!lines.length) return;

    var used = Math.min(lines.length, PAD_COUNT);
    var dropped = lines.length - used;
    var message = 'This overwrites ' + (used === 1 ? 'pad 1' : 'pads 1 to ' + used) + '. Continue?';
    if (dropped > 0) {
      message += ' ' + dropped + ' extra ' + (dropped === 1 ? 'line' : 'lines') + ' past pad 15 will be dropped.';
    }
    loadConfirmText.textContent = message;
    clearConfirm.hidden = true;
    loadConfirm.hidden = false;
    loadConfirmYes.focus();
  });

  loadConfirmNo.addEventListener('click', function () {
    loadConfirm.hidden = true;
    loadAllBtn.focus();
  });

  loadConfirmYes.addEventListener('click', function () {
    var lines = parseBulk(bulk.value);
    var used = Math.min(lines.length, PAD_COUNT);
    var dropped = lines.length - used;

    /* Position is the mapping: line 1 goes to pad 1, and pads past the last
       line are left exactly as they were. */
    for (var i = 0; i < used; i++) phrases[i] = lines[i];

    save();
    renderAll();
    loadConfirm.hidden = true;

    var status = 'Loaded ' + used + ' ' + (used === 1 ? 'phrase' : 'phrases') + ' into pads 1 to ' + used + '.';
    if (dropped > 0) {
      status += ' Dropped ' + dropped + ' extra ' + (dropped === 1 ? 'line' : 'lines') + ' past pad 15.';
    }
    setStatus(status);
    loadAllBtn.focus();
  });

  /* ---------------- share ----------------
     Trailing empty pads are omitted; empty pads in the middle become blank
     lines so positions survive a round trip through Load all. */

  function buildShareText() {
    var last = -1;
    for (var i = 0; i < PAD_COUNT; i++) {
      if ((phrases[i] || '').trim()) last = i;
    }
    if (last < 0) return '';
    return phrases.slice(0, last + 1).map(function (p) { return (p || '').trim(); }).join('\n');
  }

  function showCopyFallback(text) {
    copyFallbackText.value = text;
    copyFallback.hidden = false;
    copyFallbackText.focus();
    copyFallbackText.select();
    setStatus('Copy it manually from the box below.');
  }

  copyAllBtn.addEventListener('click', function () {
    var text = buildShareText();
    if (!text) return;

    /* The Clipboard API needs a secure context, so it is unavailable when the
       page is opened straight from disk over file://. Fall back to a
       pre-selected textarea whenever it is missing or rejects. */
    var clipboard = navigator.clipboard;
    if (!clipboard || typeof clipboard.writeText !== 'function') {
      showCopyFallback(text);
      return;
    }

    try {
      clipboard.writeText(text).then(function () {
        copyFallback.hidden = true;
        copyFallbackText.value = '';
        setStatus('Copied.');
      })['catch'](function () {
        showCopyFallback(text);
      });
    } catch (err) {
      showCopyFallback(text);
    }
  });

  /* ---------------- clear ---------------- */

  clearAllBtn.addEventListener('click', function () {
    loadConfirm.hidden = true;
    clearConfirm.hidden = false;
    clearConfirmYes.focus();
  });

  clearConfirmNo.addEventListener('click', function () {
    clearConfirm.hidden = true;
    clearAllBtn.focus();
  });

  clearConfirmYes.addEventListener('click', function () {
    stopAll();
    for (var i = 0; i < PAD_COUNT; i++) phrases[i] = '';
    save();
    renderAll();
    clearConfirm.hidden = true;
    copyFallback.hidden = true;
    copyFallbackText.value = '';
    setStatus('All pads cleared.');
    clearAllBtn.focus();
  });

  /* ---------------- pad interaction ----------------
     The whole pad is the speak trigger, like a physical pad controller. The
     text field is normally click-through (see .pad-input { pointer-events:
     none } in styles.css) so a click anywhere on the pad face reaches the pad
     itself. The small Edit button is the only way in to typing: it turns
     pointer-events back on for that pad's field and focuses it. */

  function enterEdit(n) {
    var pad = padEl(n);
    if (pad) pad.classList.add('is-editing');
    var input = padInput(n);
    if (input) input.focus();
  }

  grid.addEventListener('click', function (event) {
    if (event.target.closest('#stop-all')) {
      stopAll();
      return;
    }
    var editBtn = event.target.closest('.pad-edit');
    if (editBtn) {
      var editN = Number(editBtn.getAttribute('data-edit'));
      if (editN) enterEdit(editN);
      return;
    }
    var pad = event.target.closest('.pad');
    if (!pad) return;
    /* Reachable only while a pad is mid-edit, since the field is otherwise
       click-through. */
    if (event.target.closest('.pad-input')) return;

    var n = Number(pad.getAttribute('data-pad'));
    if (!n || n > PAD_COUNT) return;
    speakPad(n);
  });

  grid.addEventListener('input', function (event) {
    var input = event.target.closest('.pad-input');
    if (!input) return;
    var n = Number(input.getAttribute('data-pad-input'));
    if (!n || n > PAD_COUNT) return;
    phrases[n - 1] = input.value;
    save();
    renderPad(n);
    syncControls();
  });

  /* focusout bubbles (blur does not), so this single listener catches every
     pad's field losing focus and exits edit mode for it. */
  grid.addEventListener('focusout', function (event) {
    var input = event.target.closest && event.target.closest('.pad-input');
    if (!input) return;
    var pad = input.closest('.pad');
    if (pad) pad.classList.remove('is-editing');
  });

  bulk.addEventListener('input', function () {
    syncControls();
    if (!loadConfirm.hidden) loadConfirm.hidden = true;
  });

  /* ---------------- keyboard ---------------- */

  function isTextEntry(el) {
    if (!el || el === document.body) return false;
    var tag = el.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable === true;
  }

  document.addEventListener('keydown', function (event) {
    if (event.metaKey || event.ctrlKey || event.altKey || event.repeat) return;
    /* Any text field anywhere on the page swallows the shortcut, including a
       pad's own field and the bulk Load all textarea. */
    if (isTextEntry(event.target) || isTextEntry(document.activeElement)) return;

    var key = String(event.key || '').toLowerCase();
    if (key === STOP_KEY) {
      event.preventDefault();
      stopAll();
      return;
    }
    var index = PAD_KEYS.indexOf(key);
    if (index === -1) return;
    event.preventDefault();
    speakPad(index + 1);
  });

  /* ---------------- theme ----------------
     Auto follows the OS via prefers-color-scheme (styles.css); Light and Dark
     pin an explicit choice with the [data-theme] attribute, which wins over
     the system preference in both directions. */

  var currentTheme = 'auto';

  function applyTheme(mode) {
    if (mode === 'light' || mode === 'dark') {
      document.documentElement.setAttribute('data-theme', mode);
    } else {
      document.documentElement.removeAttribute('data-theme');
    }
    if (themeToggleBtn) themeToggleBtn.textContent = THEME_LABEL[mode];
  }

  function loadTheme() {
    var saved = null;
    try { saved = window.localStorage.getItem(THEME_KEY); } catch (err) { saved = null; }
    return THEME_ORDER.indexOf(saved) === -1 ? 'auto' : saved;
  }

  if (themeToggleBtn) {
    themeToggleBtn.addEventListener('click', function () {
      var index = THEME_ORDER.indexOf(currentTheme);
      currentTheme = THEME_ORDER[(index + 1) % THEME_ORDER.length];
      applyTheme(currentTheme);
      try { window.localStorage.setItem(THEME_KEY, currentTheme); } catch (err) { /* ignore */ }
      setStatus('Theme set to ' + THEME_LABEL[currentTheme] + '.');
    });
  }

  /* ---------------- start ---------------- */

  hideConfirms();
  currentTheme = loadTheme();
  applyTheme(currentTheme);
  load();
  renderAll();
})();
