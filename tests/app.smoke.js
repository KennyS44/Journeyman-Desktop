/* ==========================================================================
   tests/app.smoke.js — прогон настоящего окна программы.
   Запуск: npm run test:ui   (под Linux нужен xvfb: xvfb-run -a node ...)

   Проверяется то, что нельзя проверить модульно: окно открывается, экраны
   переключаются, данные переживают полный перезапуск программы.
   ========================================================================== */

const fs = require('fs');
const os = require('os');
const path = require('path');

const { _electron: electron } = require('./playwright');

const ROOT = path.join(__dirname, '..');
const USER_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'jm-e2e-'));
const ELECTRON = require('electron');       // пакет electron отдаёт путь к бинарнику

const steps = [];
const log = (name, value) => { steps.push({ name, value }); console.log(`  ✓ ${name}${value ? ': ' + value : ''}`); };
const fail = (msg) => { console.error(`  ✗ ${msg}`); process.exitCode = 1; };

function launch() {
  return electron.launch({
    executablePath: ELECTRON,
    args: [ROOT, `--user-data-dir=${USER_DATA}`, '--no-sandbox'],
    cwd: ROOT,
  });
}

(async () => {
  const errors = [];

  /* --- первый запуск: создаём материалы --------------------------------- */

  let app = await launch();
  let win = await app.firstWindow();
  win.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  win.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

  await win.waitForSelector('.space-card.new', { timeout: 20000 });
  log('окно открылось, меню отрисовано', await win.locator('.topbar-title').textContent());
  log('заголовок окна', await win.title());

  await win.click('.space-card.new');
  await win.fill('.modal input', 'Побережье Мечей');
  await win.click('.modal .btn-primary');
  await win.waitForSelector('.canvas-viewport');
  log('пространство создано', await win.locator('.topbar-title').textContent());

  for (const name of ['Таверна', 'Маяк']) {
    await win.click('.toolbar .btn-primary');
    await win.fill('.modal input', name);
    await win.click('.modal .btn-primary');
    await win.waitForTimeout(250);
  }
  log('объектов на холсте', String(await win.locator('.node').count()));

  // связь между двумя карточками
  await win.click('.toolbar .btn:has-text("Связь")');
  for (let i = 0; i < 2; i++) {
    const box = await win.locator('.node').nth(i).boundingBox();
    await win.mouse.move(box.x + box.width / 2, box.y + box.height - 40);
    await win.mouse.down();
    await win.mouse.up();
    await win.waitForTimeout(200);
  }
  log('нитей протянуто', String(await win.locator('.wire').count()));
  await win.keyboard.press('Escape');

  // текст внутри объекта
  await win.locator('.node-name').first().click();
  await win.waitForSelector('.doc-text');
  await win.click('.doc-text');
  await win.keyboard.type('Хозяин должен гильдии 200 зм.');
  await win.waitForTimeout(900);
  const nodeHash = await win.evaluate(() => location.hash);
  log('объект открыт', nodeHash);

  // калькулятор с кубиками
  await win.click('.panel summary:has-text("Калькулятор")');
  await win.fill('.calc-display', '2d6+3');
  await win.click('.calc-key.btn-primary');
  const calcValue = Number(await win.locator('.calc-value').textContent());
  if (!(calcValue >= 5 && calcValue <= 15)) fail(`2d6+3 дал ${calcValue}, ожидалось 5…15`);
  else log('калькулятор посчитал 2d6+3', String(calcValue));

  await win.screenshot({ path: path.join(ROOT, 'build', 'screenshot-1-node.png') });

  await app.close();
  log('программа закрыта');

  /* --- второй запуск: данные обязаны быть на месте ----------------------- */

  app = await launch();
  win = await app.firstWindow();
  win.on('pageerror', (e) => errors.push('pageerror(2): ' + e.message));

  await win.waitForSelector('.space-grid', { timeout: 20000 });
  const cards = await win.locator('.space-card:not(.new)').count();
  if (cards !== 1) fail(`после перезапуска карточек ${cards}, ожидалась 1`);
  else log('пространство на месте после перезапуска');

  await win.evaluate((h) => { location.hash = h; }, nodeHash);
  await win.waitForSelector('.doc-text');
  const text = (await win.locator('.doc-text').innerText()).trim();
  if (text !== 'Хозяин должен гильдии 200 зм.') fail(`текст после перезапуска: «${text}»`);
  else log('текст объекта пережил перезапуск');

  const links = await win.locator('.link-row').count().catch(() => 0);
  await win.click('.panel summary:has-text("Связанные директории")');
  log('связей в панели', String(await win.locator('.link-row').count() || links));

  await win.screenshot({ path: path.join(ROOT, 'build', 'screenshot-2-after-restart.png') });

  /* --- данные лежат обычными файлами ------------------------------------- */

  const dataDir = path.join(USER_DATA, 'data');
  const db = JSON.parse(fs.readFileSync(path.join(dataDir, 'db.json'), 'utf8'));
  log('db.json содержит пространств', String(Object.keys(db.spaces).length));
  log('и объектов', String(Object.keys(db.nodes).length));

  await app.close();

  if (errors.length) { console.error('\n  ОШИБКИ В КОНСОЛИ:\n   ' + errors.join('\n   ')); process.exitCode = 1; }
  else console.log('\n  ошибок в консоли нет');

  fs.rmSync(USER_DATA, { recursive: true, force: true });
  console.log(process.exitCode ? '\n  ПРОГОН ПРОВАЛЕН\n' : `\n  прогон пройден: ${steps.length} шагов\n`);
})().catch((err) => {
  console.error('\n  ПРОГОН УПАЛ:', err.message);
  process.exit(1);
});
