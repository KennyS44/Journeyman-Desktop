/* ==========================================================================
   tests/playwright.js — поиск Playwright и браузера.
   Тесты должны запускаться и на машине разработки (Playwright стоит
   глобально, а браузер лежит в кеше от другой сборки), и на сборщике CI,
   где всё ставится штатно через npx playwright install.
   ========================================================================== */

const fs = require('fs');
const os = require('os');
const path = require('path');

const GLOBAL = '/usr/local/lib/node_modules/playwright';

function load() {
  try { return require('playwright'); } catch (_) {}
  try { return require(GLOBAL); } catch (_) {}
  throw new Error('Playwright не найден: npm i -D playwright && npx playwright install chromium');
}

const pw = load();

/** Любой распакованный chromium в кеше — на случай несовпадения номеров сборок. */
function findChromium() {
  const cache = process.env.PLAYWRIGHT_BROWSERS_PATH
    || path.join(os.homedir(), '.cache', 'ms-playwright');
  let names;
  try { names = fs.readdirSync(cache); } catch (_) { return undefined; }
  const candidates = [];
  for (const name of names) {
    candidates.push(
      path.join(cache, name, 'chrome-linux', 'chrome'),
      path.join(cache, name, 'chrome-headless-shell-linux64', 'chrome-headless-shell'),
    );
  }
  return candidates.find((p) => fs.existsSync(p));
}

/** Обычный запуск, а если браузера штатной сборки нет — берём из кеша. */
async function launchChromium(options = {}) {
  try {
    return await pw.chromium.launch(options);
  } catch (err) {
    const executablePath = findChromium();
    if (!executablePath) throw err;
    return pw.chromium.launch({ ...options, executablePath });
  }
}

module.exports = { ...pw, launchChromium };
