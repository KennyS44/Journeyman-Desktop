/* ==========================================================================
   tests/zip.test.js — проверка упаковщика из src/renderer/js/zip.js.
   Запуск: node tests/zip.test.js
   Браузер не нужен: модуль не трогает DOM и отдаёт себя через module.exports.

   Отдельно проверяется совместимость с настоящими архиваторами: если в
   системе есть unzip, собранный здесь файл прогоняется через него. Без этого
   легко написать упаковщик, который читает только сам себя.
   ========================================================================== */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ZIP = require(path.join(__dirname, '..', 'src', 'renderer', 'js', 'zip.js'));

/* --- маленький бегунок --------------------------------------------------- */

const COLOR = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code, s) => (COLOR ? `\x1b[${code}m${s}\x1b[0m` : s);
const dim = (s) => paint('2', s);
const red = (s) => paint('31', s);
const green = (s) => paint('32', s);
const bold = (s) => paint('1', s);

const groups = [];
let current = null;

function group(title) {
  current = { title, cases: [] };
  groups.push(current);
}

function check(name, fn) {
  let error = null;
  try { fn(); } catch (err) { error = err.message; }
  current.cases.push({ name, error });
}

function eq(actual, expected) {
  if (actual !== expected) throw new Error(`ожидалось ${expected}, получено ${actual}`);
}

/** Обязано упасть, текст ошибки можно проверить по подстроке. */
function fails(name, fn, part) {
  check(name, () => {
    let err = null;
    try { fn(); } catch (e) { err = e; }
    if (!err) throw new Error('ошибки не было');
    if (part && !err.message.includes(part)) throw new Error(`текст ошибки: «${err.message}»`);
  });
}

const enc = (s) => new TextEncoder().encode(s);
const dec = (b) => new TextDecoder().decode(b);
const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

/* --- контрольная сумма ---------------------------------------------------- */

group('Контрольная сумма');

// значение из стандарта на CRC-32: строка «123456789»
check('123456789 → 0xcbf43926', () => eq(ZIP.crc32(enc('123456789')), 0xcbf43926));
check('пустые данные → 0', () => eq(ZIP.crc32(new Uint8Array(0)), 0));

/* --- круг: записали и прочитали ------------------------------------------ */

group('Запись и чтение');

check('пустой архив читается', () => eq(ZIP.read(ZIP.write([])).size, 0));

check('один файл возвращается дословно', () => {
  const back = ZIP.read(ZIP.write([{ name: 'a.txt', data: enc('привет') }]));
  eq(back.size, 1);
  eq(dec(back.get('a.txt')), 'привет');
});

check('пустой файл не теряется', () => {
  const back = ZIP.read(ZIP.write([{ name: 'empty.bin', data: new Uint8Array(0) }]));
  eq(back.has('empty.bin'), true);
  eq(back.get('empty.bin').length, 0);
});

check('имена в кириллице переживают круг', () => {
  const back = ZIP.read(ZIP.write([{ name: 'assets/кар та «1».bin', data: enc('x') }]));
  eq(back.has('assets/кар та «1».bin'), true);
});

check('несколько файлов сохраняют содержимое', () => {
  const big = new Uint8Array(300000);
  for (let i = 0; i < big.length; i++) big[i] = (i * 31) & 255;
  const entries = [
    { name: 'codex.json', data: enc(JSON.stringify({ spaces: [] })) },
    { name: 'assets/1.bin', data: big },
    { name: 'assets/2.bin', data: enc('второй') },
  ];
  const back = ZIP.read(ZIP.write(entries));
  eq(back.size, 3);
  eq(same(back.get('assets/1.bin'), big), true);
  eq(dec(back.get('assets/2.bin')), 'второй');
});

check('данные не съезжают: файл после крупного соседа цел', () => {
  const big = new Uint8Array(70000).fill(7);
  const back = ZIP.read(ZIP.write([
    { name: 'big.bin', data: big },
    { name: 'tail.txt', data: enc('хвост') },
  ]));
  eq(dec(back.get('tail.txt')), 'хвост');
});

/* --- испорченные файлы ---------------------------------------------------- */

group('Порча и чужие файлы');

fails('обычный текст вместо архива', () => ZIP.read(enc('это просто текст, а не архив')), 'не zip');
fails('слишком короткий файл', () => ZIP.read(new Uint8Array(4)), 'слишком мал');

fails('подмена байта в содержимом', () => {
  const zip = ZIP.write([{ name: 'a.txt', data: enc('исходное содержимое файла') }]);
  zip[45] ^= 0xff;
  ZIP.read(zip);
}, 'повреждён');

fails('обрубленный хвост', () => {
  const zip = ZIP.write([{ name: 'a.txt', data: enc('содержимое') }]);
  ZIP.read(zip.slice(0, zip.length - 30));
}, 'zip');

fails('слишком много файлов', () => {
  const many = Array.from({ length: 65536 }, (_, i) => ({ name: 'f' + i, data: new Uint8Array(0) }));
  ZIP.write(many);
}, 'Слишком много');

/* --- совместимость с настоящими архиваторами ------------------------------ */

group('Совместимость');

const haveTool = (name) => {
  try { execFileSync('which', [name], { stdio: 'ignore' }); return true; } catch (_) { return false; }
};

if (haveTool('unzip')) {
  check('системный unzip не находит ошибок', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jm-zip-'));
    const file = path.join(dir, 'test.zip');
    const body = new Uint8Array(50000).fill(3);
    fs.writeFileSync(file, ZIP.write([
      { name: 'codex.json', data: enc('{"format":"journeyman-codex"}') },
      { name: 'assets/a.bin', data: body },
    ]));
    let out;
    try { out = execFileSync('unzip', ['-t', file], { encoding: 'utf8' }); }
    finally { fs.rmSync(dir, { recursive: true, force: true }); }
    if (!/No errors detected/.test(out)) throw new Error(out.trim().split('\n').pop());
  });
} else {
  check('системный unzip не найден — проверка пропущена', () => {});
}

if (haveTool('zip')) {
  check('архив от системного zip читается нашим кодом', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jm-zip-'));
    try {
      fs.mkdirSync(path.join(dir, 'assets'));
      fs.writeFileSync(path.join(dir, 'codex.json'), 'снаружи');
      fs.writeFileSync(path.join(dir, 'assets', 'a.bin'), Buffer.alloc(1000, 9));
      // -0 : без сжатия, как пишем и мы
      execFileSync('zip', ['-q', '-r', '-0', 'out.zip', 'codex.json', 'assets'], { cwd: dir });
      const back = ZIP.read(fs.readFileSync(path.join(dir, 'out.zip')));
      eq(dec(back.get('codex.json')), 'снаружи');
      eq(back.get('assets/a.bin').length, 1000);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  fails('сжатый архив отвергается с внятной ошибкой', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jm-zip-'));
    try {
      fs.writeFileSync(path.join(dir, 'a.txt'), 'а'.repeat(5000));
      execFileSync('zip', ['-q', '-9', 'out.zip', 'a.txt'], { cwd: dir });
      ZIP.read(fs.readFileSync(path.join(dir, 'out.zip')));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }, 'сжат');
} else {
  check('системный zip не найден — проверка пропущена', () => {});
}

/* --- отчёт ---------------------------------------------------------------- */

const all = groups.flatMap((g) => g.cases);
const broken = all.filter((c) => c.error);

console.log(`\n${bold('Упаковщик')} ${dim('src/renderer/js/zip.js')}\n`);
for (const g of groups) {
  const bad = g.cases.filter((c) => c.error).length;
  console.log(`  ${g.title} ${dim(`(${g.cases.length - bad}/${g.cases.length})`)}`);
  for (const c of g.cases) {
    if (c.error) console.log(`    ${red('✗')} ${c.name}\n      ${red(c.error)}`);
    else console.log(`    ${green('✓')} ${dim(c.name)}`);
  }
  console.log('');
}

const summary = broken.length
  ? red(`✗ провалено ${broken.length} из ${all.length}`)
  : green(`✓ все ${all.length} проверок прошли`);
console.log(`  ${bold(summary)}\n`);
process.exit(broken.length ? 1 : 0);
