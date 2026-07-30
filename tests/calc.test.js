/* ==========================================================================
   tests/calc.test.js — проверка парсера выражений из src/renderer/js/calc.js.
   Запуск: node tests/calc.test.js
   Браузеру не нужен: файл calc.js читается как текст и выполняется здесь,
   виджеты (UI, DOM) при этом не трогаются.
   ========================================================================== */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'js', 'calc.js'), 'utf8');
const sandbox = { window: {}, Math, Number, Date, console };
vm.createContext(sandbox);
// calc.js объявляет CALC через const — в объект контекста он не попадёт,
// поэтому берём его как значение последнего выражения скрипта.
const { evaluate, format } = vm.runInContext(source + '\n;CALC;', sandbox, { filename: 'src/renderer/js/calc.js' });

/* --- маленький бегунок --------------------------------------------------- */

const COLOR = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code, s) => (COLOR ? `\x1b[${code}m${s}\x1b[0m` : s);
const dim = (s) => paint('2', s);
const red = (s) => paint('31', s);
const green = (s) => paint('32', s);
const bold = (s) => paint('1', s);

const groups = [];
let current = null;

/** Начинает раздел: следующие проверки попадут под этот заголовок. */
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

/** Выражение считается и даёт ровно это число. */
function value(src, expected) {
  check(`${src} = ${expected}`, () => eq(evaluate(src).value, expected));
}

/** Выражение обязано упасть с ошибкой (текст можно проверить по подстроке). */
function fails(src, part) {
  check(`${src} → ошибка${part ? ` «${part}»` : ''}`, () => {
    let err = null;
    try { evaluate(src); } catch (e) { err = e; }
    if (!err) throw new Error('ошибки не было');
    if (part && !err.message.includes(part)) throw new Error(`текст ошибки: «${err.message}»`);
  });
}

/** Бросок: значение должно попадать в границы count..count*faces. */
function inRange(src, min, max, runs = 200) {
  check(`${src} ∈ [${min}, ${max}]`, () => {
    for (let i = 0; i < runs; i++) {
      const v = evaluate(src).value;
      if (v < min || v > max) throw new Error(`выпало ${v}`);
    }
  });
}

/* --- проверки ------------------------------------------------------------ */

group('Арифметика');
value('2+2', 4);
value('2+2*2', 6);
value('(2+2)*2', 8);
value('10/4', 2.5);
value('7-3-2', 2);          // левая ассоциативность
value('100/10/2', 5);
value('-5+8', 3);
value('-(3+4)', -7);
value('--5', 5);
value('+7', 7);
value('2*-3', -6);
value('((((1))))', 1);

group('Запись чисел и знаков');
value('1,5+1,5', 3);        // запятая как десятичный разделитель
value('2 + 2', 4);          // пробелы
value('6×7', 42);           // типографские знаки
value('84÷2', 42);
value('5−2', 3);            // минус U+2212
value('1.5*2', 3);
value('.5+.5', 1);
fails('1.2.3', 'Непонятное число');   // два разделителя — это не число

group('Ошибки разбора');
fails('2+', 'обрывается');
fails('(2+2', 'Не закрыта скобка');
fails('2+2)', 'Лишнее в конце');
fails('2**2', 'ожидалось число');
fails('1/0', 'Деление на ноль');
fails('10/(5-5)', 'Деление на ноль');
fails('2 $ 2', 'Непонятный символ');
fails('()', 'ожидалось число');

group('Кубики');
inRange('d20', 1, 20);
inRange('2d6', 2, 12);
inRange('4d6*2', 8, 48);
inRange('d20+5', 6, 25);
inRange('2d6+d4', 3, 16);
inRange('к20', 1, 20);      // русская «к»
inRange('д6', 1, 6);        // русская «д»
inRange('D8', 1, 8);        // верхний регистр

check('2d6 отдаёт разбор броска', () => {
  const r = evaluate('2d6');
  eq(r.rolls.length, 1);
  eq(r.rolls[0].spec, '2d6');
  eq(r.rolls[0].dice.length, 2);
  eq(r.rolls[0].dice.reduce((a, b) => a + b, 0), r.value);
});
check('2d6+d4 отдаёт два броска', () => eq(evaluate('2d6+d4').rolls.length, 2));

group('Границы кубиков');
fails('d1', 'хотя бы d2');
fails('0d6', 'хотя бы d2');
fails('201d6', 'Не больше 200');
fails('d1001', 'Не больше d1000');
fails('2d', 'нужно число граней');
fails('d', 'нужно число граней');
fails('2d6d4', 'Лишнее в конце');

group('Вывод чисел');
check('целое без хвоста', () => eq(format(42), '42'));
check('дробное с точкой', () => eq(format(2.5), '2.5'));
check('отрицательное', () => eq(format(-3), '-3'));

/* --- отчёт --------------------------------------------------------------- */

const all = groups.flatMap((g) => g.cases);
const broken = all.filter((c) => c.error);

console.log(`\n${bold('Парсер выражений')} ${dim('src/renderer/js/calc.js')}\n`);
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
