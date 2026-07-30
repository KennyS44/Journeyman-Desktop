/* ==========================================================================
   tests/renderer.smoke.js — прогон экранов поверх настоящего хранилища,
   но без Electron.
   Запуск: node tests/renderer.smoke.js

   Зачем отдельно от app.smoke.js: полноценное окно Electron требует GTK и
   графической оболочки, которых нет на сборочных машинах без рабочего стола.
   Здесь index.html открывается в headless-Chromium, а мост window.journeyman
   подменяется вызовом того же src/main/storage.js в Node. Проверяется связка
   «экраны → адаптер db.js → хранилище на диске» целиком.

   Отличие от настоящего IPC ровно одно: Playwright передаёт аргументы через
   JSON, поэтому двоичное содержимое здесь ездит base64. В Electron это
   структурное клонирование, которое понимает Uint8Array без преобразований.
   ========================================================================== */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { launchChromium } = require('./playwright');
const { createStorage } = require('../src/main/storage');

const ROOT = path.join(__dirname, '..');

const passed = [];
const failed = [];
const ok = (name, value) => { passed.push(name); console.log(`  ✓ ${name}${value ? ': ' + value : ''}`); };
const bad = (name, why) => { failed.push(name); console.log(`  ✗ ${name}: ${why}`); };
const expect = (name, actual, wanted) =>
  (actual === wanted ? ok(name, String(actual)) : bad(name, `ожидалось ${wanted}, получено ${actual}`));

(async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jm-renderer-'));
  let store = createStorage(dataDir);

  const browser = await launchChromium();
  // мост ставится на контекст, а не на страницу: после «перезапуска» открывается
  // новая страница, и она должна получить его тем же способом
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const errors = [];
  ctx.on('page', (p) => {
    p.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    p.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  });

  // то же, что делает preload + main, но через функцию Playwright
  await ctx.exposeFunction('__jmBridge', (method, args) => {
    const revived = args.map((a) =>
      (a && typeof a === 'object' && a.__bytes ? { ...a, bytes: Buffer.from(a.__bytes, 'base64') } : a));
    const result = store[method](...revived);
    if (result && result.bytes) return { ...result, __bytes: Buffer.from(result.bytes).toString('base64') };
    return result === undefined ? null : result;
  });
  await ctx.addInitScript(() => {
    window.journeyman = {
      db: async (method, ...args) => {
        const packed = args.map((a) => (a && a.bytes
          ? { ...a, bytes: undefined, __bytes: btoa(String.fromCharCode(...a.bytes)) }
          : a));
        const res = await window.__jmBridge(method, packed);
        if (res && res.__bytes) {
          const bin = atob(res.__bytes);
          const bytes = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
          return { ...res, bytes };
        }
        return res;
      },
      platform: 'test',
    };
  });

  const page = await ctx.newPage();
  const url = 'file://' + path.join(ROOT, 'src', 'renderer', 'index.html');
  await page.goto(url);
  await page.waitForSelector('.space-card.new', { timeout: 15000 });
  ok('меню отрисовано поверх файлового хранилища', await page.locator('.topbar-title').textContent());

  /* --- пространство и объекты ------------------------------------------- */

  await page.click('.space-card.new');
  await page.fill('.modal input', 'Побережье Мечей');
  await page.click('.modal .btn-primary');
  await page.waitForSelector('.canvas-viewport');
  ok('пространство создано', await page.locator('.topbar-title').textContent());
  expect('пространств записано на диск', store.listSpaces().length, 1);

  for (const name of ['Таверна', 'Маяк']) {
    await page.click('.toolbar .btn-primary');
    await page.fill('.modal input', name);
    await page.click('.modal .btn-primary');
    await page.waitForTimeout(200);
  }
  expect('карточек на холсте', await page.locator('.node').count(), 2);

  /* --- связь -------------------------------------------------------------- */

  await page.click('.toolbar .btn:has-text("Связь")');
  for (let i = 0; i < 2; i++) {
    const box = await page.locator('.node').nth(i).boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height - 40);
    await page.mouse.down();
    await page.mouse.up();
    await page.waitForTimeout(200);
  }
  expect('нить нарисована', await page.locator('.wire').count(), 1);
  await page.keyboard.press('Escape');

  /* --- текст и файл внутри объекта --------------------------------------- */

  await page.locator('.node-name').first().click();
  await page.waitForSelector('.doc-text');
  await page.click('.doc-text');
  await page.keyboard.type('Хозяин должен гильдии 200 зм.');
  await page.waitForTimeout(900);
  const hash = await page.evaluate(() => location.hash);
  const nodeId = hash.split('/').pop();
  expect('текст сохранён в файловое хранилище',
    store.getNode(nodeId).text, 'Хозяин должен гильдии 200 зм.');

  // загрузка картинки: File создаётся в странице, путь тот же, что у пользователя
  await page.setInputFiles('#file-input', {
    name: 'карта.png', mimeType: 'image/png',
    buffer: Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex'),
  });
  const assetsBefore = store.listAssets(nodeId).length;
  await page.evaluate(async () => {
    const input = document.getElementById('file-input');
    const file = input.files[0];
    const a = await DB.addAsset(location.hash.split('/').pop(), file, 'image');
    window.__asset = { id: a.id, size: a.size, isBlob: a.blob instanceof Blob };
  });
  const asset = await page.evaluate(() => window.__asset);
  expect('файл записан на диск', store.listAssets(nodeId).length, assetsBefore + 1);
  expect('адаптер вернул готовый Blob', asset.isBlob, true);
  expect('размер файла сошёлся', store.getAsset(asset.id).bytes.length, asset.size);

  /* --- калькулятор -------------------------------------------------------- */

  await page.click('.panel summary:has-text("Калькулятор")');
  await page.fill('.calc-display', '2d6+3');
  await page.click('.calc-key.btn-primary');
  const value = Number(await page.locator('.calc-value').textContent());
  if (value >= 5 && value <= 15) ok('калькулятор посчитал 2d6+3', String(value));
  else bad('калькулятор', `2d6+3 дал ${value}`);

  /* --- перезапуск: данные обязаны пережить -------------------------------- */

  await page.close();
  store = createStorage(dataDir);                    // как будто программу закрыли и открыли
  const page2 = await ctx.newPage();
  await page2.goto(url + hash);
  await page2.waitForSelector('.doc-text', { timeout: 15000 });
  expect('текст пережил перезапуск',
    (await page2.locator('.doc-text').innerText()).trim(), 'Хозяин должен гильдии 200 зм.');
  await page2.click('.panel summary:has-text("Изображения и видео")');
  expect('картинка на месте после перезапуска', await page2.locator('.gallery-item').count(), 1);

  await page2.goto(url + '#/');
  await page2.waitForSelector('.space-grid');
  expect('пространство на месте', await page2.locator('.space-card:not(.new)').count(), 1);

  /* --- данные — обычные файлы --------------------------------------------- */

  const dbJson = JSON.parse(fs.readFileSync(path.join(dataDir, 'db.json'), 'utf8'));
  expect('в db.json одно пространство', Object.keys(dbJson.spaces).length, 1);
  expect('в db.json два объекта', Object.keys(dbJson.nodes).length, 2);
  expect('в папке assets один файл', fs.readdirSync(path.join(dataDir, 'assets')).length, 1);

  await browser.close();
  fs.rmSync(dataDir, { recursive: true, force: true });

  if (errors.length) { console.log('\n  ОШИБКИ В КОНСОЛИ:\n   ' + errors.join('\n   ')); failed.push('консоль'); }
  else console.log('\n  ошибок в консоли нет');

  console.log(failed.length
    ? `\n  ПРОВАЛЕНО ${failed.length}, пройдено ${passed.length}\n`
    : `\n  прогон пройден полностью: ${passed.length} проверок\n`);
  process.exit(failed.length ? 1 : 0);
})().catch((err) => {
  console.error('\n  ПРОГОН УПАЛ:', err.stack);
  process.exit(1);
});
