/* Wonderwalle QA - headless Chromium against the local app.
 *
 * The app itself has no dependencies. This script is dev-only and needs
 * Playwright:  npm install  &&  npx playwright install chromium
 * Run it with: npm run qa
 *
 * The local files are served over http://127.0.0.1 rather than opened via
 * file:// so the page gets a secure context, which is what localStorage and
 * the Clipboard API see on GitHub Pages too.
 */

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, normalize } from 'node:path';
import { chromium } from 'playwright';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const SHOT = join(HERE, 'preview.png');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
};

const SAMPLE = [
  'Good morning',
  'On my way',
  'Give me five minutes',
  'Coffee is ready',
  'Back in a moment',
  'Can you hear me',
  'Time for a break',
  'Almost done',
  'Nice work',
  'Try that again',
  'Ready when you are',
  'The meeting starts now',
  'Time to wrap up',
  'See you tomorrow',
  'Goodnight',
];

/* ---------------- static server ---------------- */

function startServer() {
  const server = createServer(async (req, res) => {
    const path = (req.url || '/').split('?')[0];
    if (path === '/favicon.ico') {
      res.writeHead(204).end();          /* keeps a 404 out of the console-error check */
      return;
    }
    const rel = path === '/' ? 'index.html' : path.replace(/^\/+/, '');
    const file = normalize(join(ROOT, rel));
    if (!file.startsWith(ROOT)) {
      res.writeHead(403).end('forbidden');
      return;
    }
    try {
      const body = await readFile(file);
      const ext = file.slice(file.lastIndexOf('.'));
      res.writeHead(200, { 'content-type': TYPES[ext] || 'application/octet-stream' }).end(body);
    } catch {
      res.writeHead(404).end('not found');
    }
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, base: `http://127.0.0.1:${server.address().port}` });
    });
  });
}

/* ---------------- harness ---------------- */

/* Records speech and clipboard writes instead of performing them. Headless
   Chromium has no real voices, and stubbing keeps the assertions deterministic. */
const INIT = `
  window.__qa = { spoken: [], cancels: 0, clipboard: [], errors: [] };
  (function () {
    var s = window.speechSynthesis;
    if (s) {
      Object.defineProperty(s, 'speak', {
        configurable: true, writable: true,
        value: function (u) { window.__qa.spoken.push(u && u.text); }
      });
      Object.defineProperty(s, 'cancel', {
        configurable: true, writable: true,
        value: function () { window.__qa.cancels++; }
      });
    }
    var write = function (text) { window.__qa.clipboard.push(String(text)); return Promise.resolve(); };
    if (navigator.clipboard) {
      Object.defineProperty(navigator.clipboard, 'writeText', {
        configurable: true, writable: true, value: write
      });
    } else {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true, value: { writeText: write }
      });
    }
  })();
`;

const failures = [];
let browser;
let base;

async function openPage(extraInit) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: base });
  await context.addInitScript(INIT);
  if (extraInit) await context.addInitScript(extraInit);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (err) => errors.push(String(err)));
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
  page.errors = errors;
  await page.goto(base);
  await page.waitForSelector('.pad');
  return { context, page };
}

async function test(name, fn, extraInit) {
  const { context, page } = await openPage(extraInit);
  try {
    await fn(page);
    if (page.errors.length) throw new Error('page errors: ' + page.errors.join(' | '));
    console.log(`  PASS  ${name}`);
  } catch (err) {
    failures.push(name);
    console.log(`  FAIL  ${name}\n        ${err && err.message ? err.message : err}`);
  } finally {
    await context.close();
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertEqual(actual, expected, message) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${message}\n        expected: ${e}\n        actual:   ${a}`);
}

/* ---------------- page helpers ---------------- */

const padValue = (page, n) => page.getAttribute(`#pad-${n}`, 'data-phrase');

async function allPadValues(page) {
  const out = [];
  for (let n = 1; n <= 15; n++) out.push(await padValue(page, n));
  return out;
}

/* Pads have no editing UI of their own; Load all is the app's only path for
   changing one, and its parser deliberately trims one incidental leading or
   trailing blank line from a paste. That makes it impossible to represent
   "pad 1 is blank, later pads are not" through a paste, since a genuinely
   blank first line is indistinguishable from an accidental one and always
   gets trimmed. This helper is test setup, not a UI exercise, so it seeds
   localStorage directly (the same format app.js reads on load) and reloads,
   sidestepping that ambiguity entirely. The real paste/parse behavior is
   covered by the dedicated bulk-load tests below. */
async function setPad(page, n, text) {
  await page.evaluate(({ n, text, key }) => {
    let phrases;
    try {
      phrases = JSON.parse(window.localStorage.getItem(key) || 'null');
    } catch (err) {
      phrases = null;
    }
    if (!Array.isArray(phrases)) phrases = new Array(15).fill('');
    phrases[n - 1] = text;
    window.localStorage.setItem(key, JSON.stringify(phrases));
  }, { n, text, key: 'wonderwalle.phrases.v1' });
  await page.reload();
  await page.waitForSelector('.pad');
}

async function bulkLoad(page, text) {
  await page.fill('#bulk', text);
  await page.click('#load-all');
  await page.click('#load-confirm-yes');
}

async function blurFields(page) {
  await page.evaluate(() => document.activeElement && document.activeElement.blur());
}

const spoken = (page) => page.evaluate(() => window.__qa.spoken);
const clipboard = (page) => page.evaluate(() => window.__qa.clipboard);

/* ---------------- tests ---------------- */

async function main() {
  const { server, base: url } = await startServer();
  base = url;
  browser = await chromium.launch();
  console.log(`\nWonderwalle QA  (${base})\n`);

  await test('renders exactly 16 pads and the sixteenth is Stop All', async (page) => {
    assertEqual(await page.locator('.pad').count(), 16, 'pad count');
    const last = page.locator('.pad').nth(15);
    assertEqual(await last.locator('#stop-all').count(), 1, 'sixteenth pad holds the Stop All control');
    assert((await last.innerText()).includes('Stop All'), 'sixteenth pad reads Stop All');
  });

  await test('the theme toggle cycles Auto to Light to Dark and persists across reload', async (page) => {
    const attr = () => page.evaluate(() => document.documentElement.getAttribute('data-theme'));
    const label = () => page.textContent('#theme-toggle');

    assertEqual(await attr(), null, 'starts in Auto (no explicit attribute)');
    assertEqual(await label(), 'Auto', 'button reads Auto');

    await page.click('#theme-toggle');
    assertEqual(await attr(), 'light', 'Light sets data-theme="light"');
    assertEqual(await label(), 'Light', 'button reads Light');

    await page.click('#theme-toggle');
    assertEqual(await attr(), 'dark', 'Dark sets data-theme="dark"');
    assertEqual(await label(), 'Dark', 'button reads Dark');

    await page.reload();
    await page.waitForSelector('.pad');
    assertEqual(await attr(), 'dark', 'Dark choice survives a reload');

    await page.click('#theme-toggle');
    assertEqual(await attr(), null, 'cycling past Dark returns to Auto');
  });

  await test('a typed phrase survives a reload via localStorage', async (page) => {
    await setPad(page, 3, 'Coffee is ready');
    await page.reload();
    await page.waitForSelector('.pad');
    assertEqual(await padValue(page, 3), 'Coffee is ready', 'pad 3 restored after reload');
  });

  await test('a mapped key does not speak while the Load all textarea is focused', async (page) => {
    await setPad(page, 5, 'Back in a moment');
    await page.focus('#bulk');
    await page.keyboard.press('q');
    assertEqual(await spoken(page), [], 'no speech while the bulk textarea is focused');
  });

  await test('a mapped key speaks when no text field is focused', async (page) => {
    await setPad(page, 5, 'Back in a moment');
    await blurFields(page);
    await page.keyboard.press('q');
    assertEqual(await spoken(page), ['Back in a moment'], 'pad 5 spoke via the Q key');
  });

  await test('clicking anywhere on a pad speaks it (whole pad is the trigger) and Stop All cancels', async (page) => {
    await setPad(page, 1, 'Good morning');
    await page.click('.pad[data-pad="1"]');
    assertEqual(await spoken(page), ['Good morning'], 'pad 1 spoke on click');
    await page.click('#stop-all');
    assert(await page.evaluate(() => window.__qa.cancels) > 0, 'Stop All called cancel');
    assertEqual(await page.locator('.pad.is-playing').count(), 0, 'playing state cleared');
  });

  await test('pads have no editing controls; Load all is the only way to change one', async (page) => {
    assertEqual(await page.locator('.pad-edit').count(), 0, 'no Edit buttons anywhere');
    assertEqual(await page.locator('#grid textarea').count(), 0, 'no editable fields inside pads');
  });

  await test('an empty pad is inert and marked as empty', async (page) => {
    assert(await page.locator('.pad[data-pad="2"]').evaluate((el) => el.classList.contains('is-empty')),
      'empty pad carries the is-empty class');
    await page.click('.pad[data-pad="2"]');
    assertEqual(await spoken(page), [], 'empty pad does not speak');
  });

  await test('voice selection does not throw when getVoices() returns empty', async (page) => {
    assertEqual(await page.evaluate(() => window.speechSynthesis.getVoices()), [], 'getVoices stub is empty');
    await setPad(page, 1, 'Good morning');
    await blurFields(page);
    await page.keyboard.press('1');
    assertEqual(await spoken(page), ['Good morning'], 'speech still requested with no voices available');
  }, `Object.defineProperty(window.speechSynthesis, 'getVoices', {
        configurable: true, writable: true, value: function () { return []; }
      });`);

  await test('bulk load fills pads 1 to N in order and leaves later pads untouched', async (page) => {
    await setPad(page, 10, 'Untouched marker');
    await bulkLoad(page, 'Good morning\nOn my way\nAlmost done');
    assertEqual(await padValue(page, 1), 'Good morning', 'pad 1');
    assertEqual(await padValue(page, 2), 'On my way', 'pad 2');
    assertEqual(await padValue(page, 3), 'Almost done', 'pad 3');
    assertEqual(await padValue(page, 4), '', 'pad 4 stays empty');
    assertEqual(await padValue(page, 10), 'Untouched marker', 'pad 10 untouched');
  });

  await test('bulk load drops lines past pad 15 and says so', async (page) => {
    const lines = Array.from({ length: 18 }, (_, i) => `Phrase ${i + 1}`);
    await bulkLoad(page, lines.join('\n'));
    assertEqual(await padValue(page, 15), 'Phrase 15', 'pad 15 holds line 15');
    assert((await page.textContent('#status')).includes('Dropped 3'), 'status reports the dropped lines');
  });

  await test('a phrase containing a comma survives bulk load as one pad', async (page) => {
    await bulkLoad(page, 'Coffee is ready, come and get it\nOn my way');
    assertEqual(await padValue(page, 1), 'Coffee is ready, come and get it', 'comma phrase kept whole');
    assertEqual(await padValue(page, 2), 'On my way', 'next line landed on pad 2');
  });

  await test('a single trailing blank line neither clears nor shifts the last pad', async (page) => {
    await bulkLoad(page, 'Good morning\nOn my way\nAlmost done\n');
    assertEqual(await padValue(page, 3), 'Almost done', 'pad 3 keeps its phrase');
    assertEqual(await padValue(page, 4), '', 'no phantom pad beyond the last line');
    assertEqual((await page.textContent('#status')).includes('pads 1 to 3'), true, 'status counts 3 phrases');
  });

  await test('an interior blank line clears that pad', async (page) => {
    await setPad(page, 2, 'Untouched marker');
    await bulkLoad(page, 'Good morning\n\nAlmost done');
    assertEqual(await padValue(page, 2), '', 'pad 2 cleared by the blank line');
    assertEqual(await padValue(page, 3), 'Almost done', 'pad 3 keeps its position');
  });

  /* Known, spec-mandated limitation, not a regression: the single-blank-line
     trim can't tell a genuinely blank pad 1 from an accidental leading blank,
     so it always trims it, shifting everything up by one. Documented here so
     it stays visible and isn't reintroduced-as-fixed by accident. */
  await test('KNOWN LIMITATION: a leading blank pad does not round-trip through Copy all / Load all', async (page) => {
    await bulkLoad(page, '\nOn my way\nAlmost done');
    assertEqual(await padValue(page, 1), 'On my way', 'the leading blank is trimmed, not preserved as pad 1');
    assertEqual(await padValue(page, 2), 'Almost done', 'every later phrase shifts up by one position');
  });

  /* A textarea normalizes CRLF to LF in its value, so the app's own normalization
     is a second line of defense rather than the only one. This checks the
     observable requirement: both blocks land on the pads identically. */
  await test('CRLF line endings split the same way as LF', async (page) => {
    await bulkLoad(page, 'Good morning\r\nOn my way\r\nAlmost done\r\n');
    const crlf = await allPadValues(page);
    const { context, page: page2 } = await openPage();
    try {
      await bulkLoad(page2, 'Good morning\nOn my way\nAlmost done\n');
      assertEqual(crlf, await allPadValues(page2), 'CRLF and LF blocks produce identical pads');
    } finally {
      await context.close();
    }
  });

  await test('Copy all round-trips through Load all to the same 15 phrases', async (page) => {
    const set = SAMPLE.slice();
    set[6] = '';                       /* a gap in the middle must survive */
    set[3] = 'Coffee is ready, come and get it';
    for (let n = 1; n <= 15; n++) await setPad(page, n, set[n - 1]);

    await page.click('#copy-all');
    await page.waitForFunction(() => window.__qa.clipboard.length > 0);
    const copied = (await clipboard(page))[0];
    assertEqual(copied.split('\n').length, 15, 'copied block has one line per pad');
    assertEqual(await page.textContent('#status'), 'Copied.', 'copy confirmation shown');

    await page.click('#clear-all');
    await page.click('#clear-confirm-yes');
    assertEqual(await allPadValues(page), new Array(15).fill(''), 'clear all emptied every pad');

    await bulkLoad(page, copied);
    assertEqual(await allPadValues(page), set, 'round trip restored the same 15 phrases');
  });

  await test('Load all is disabled when empty and Copy all is disabled with no phrases', async (page) => {
    assert(await page.isDisabled('#load-all'), 'Load all starts disabled');
    assert(await page.isDisabled('#copy-all'), 'Copy all starts disabled');
    await page.fill('#bulk', 'Good morning');
    assert(await page.isEnabled('#load-all'), 'Load all enables once the textarea has text');
    await setPad(page, 1, 'Good morning');
    assert(await page.isEnabled('#copy-all'), 'Copy all enables once a pad has a phrase');
    await page.fill('#bulk', '');
    assert(await page.isDisabled('#load-all'), 'Load all disables again when emptied');
  });

  await test('Copy all falls back to a selectable textarea without the Clipboard API', async (page) => {
    await setPad(page, 1, 'Good morning');
    await page.click('#copy-all');
    await page.waitForSelector('#copy-fallback:not([hidden])');
    assertEqual(await page.inputValue('#copy-fallback-text'), 'Good morning', 'fallback holds the share text');
  }, `Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });`);

  await test('writes qa/preview.png', async (page) => {
    for (let n = 1; n <= 15; n++) await setPad(page, n, SAMPLE[n - 1]);
    await blurFields(page);
    await page.screenshot({ path: SHOT });
  });

  await browser.close();
  server.close();

  console.log('');
  if (failures.length) {
    console.log(`${failures.length} failing:\n  - ${failures.join('\n  - ')}\n`);
    process.exit(1);
  }
  console.log(`All checks passed. Screenshot: ${SHOT}\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
