/* ==========================================================================
   calc.js — калькулятор мастера.
   Считает обычную арифметику и броски кубиков: 2d6+3, d20+5, 4d6*2.
   Разбор рекурсивным спуском, без eval.
   ========================================================================== */

const CALC = (() => {

  const MAX_DICE = 200;          // защита от «10000d6»
  const MAX_SIDES = 1000;

  /* --- разбор выражения -------------------------------------------------- */

  function tokenize(src) {
    const out = [];
    const s = src.replace(/[×х]/gi, '*').replace(/[÷]/g, '/').replace(/[−–—]/g, '-').replace(/,/g, '.');
    let i = 0;
    while (i < s.length) {
      const c = s[i];
      if (c === ' ') { i++; continue; }
      if (/[0-9.]/.test(c)) {
        let j = i;
        while (j < s.length && /[0-9.]/.test(s[j])) j++;
        const raw = s.slice(i, j);
        // parseFloat молча обрезает хвост («1.2.3» → 1.2), поэтому проверяем вид числа
        if (!/^(\d+(\.\d*)?|\.\d+)$/.test(raw)) throw new Error('Непонятное число');
        const num = parseFloat(raw);
        out.push({ t: 'num', v: num });
        i = j;
        continue;
      }
      if (/[dкд]/i.test(c)) { out.push({ t: 'd' }); i++; continue; }
      if ('+-*/'.includes(c)) { out.push({ t: 'op', v: c }); i++; continue; }
      if (c === '(') { out.push({ t: '(' }); i++; continue; }
      if (c === ')') { out.push({ t: ')' }); i++; continue; }
      throw new Error(`Непонятный символ «${c}»`);
    }
    return out;
  }

  function evaluate(src) {
    const tokens = tokenize(src);
    const rolls = [];
    let pos = 0;
    const peek = () => tokens[pos];
    const eat = () => tokens[pos++];

    function expr() {
      let v = term();
      while (peek() && peek().t === 'op' && (peek().v === '+' || peek().v === '-')) {
        const op = eat().v;
        const r = term();
        v = op === '+' ? v + r : v - r;
      }
      return v;
    }

    function term() {
      let v = unary();
      while (peek() && peek().t === 'op' && (peek().v === '*' || peek().v === '/')) {
        const op = eat().v;
        const r = unary();
        if (op === '/' && r === 0) throw new Error('Деление на ноль');
        v = op === '*' ? v * r : v / r;
      }
      return v;
    }

    function unary() {
      if (peek() && peek().t === 'op' && peek().v === '-') { eat(); return -unary(); }
      if (peek() && peek().t === 'op' && peek().v === '+') { eat(); return unary(); }
      return primary();
    }

    function primary() {
      const tk = peek();
      if (!tk) throw new Error('Выражение обрывается');

      // кубик без количества: d20
      if (tk.t === 'd') { eat(); return roll(1, sides()); }

      if (tk.t === 'num') {
        eat();
        if (peek() && peek().t === 'd') { eat(); return roll(tk.v, sides()); }
        return tk.v;
      }

      if (tk.t === '(') {
        eat();
        const v = expr();
        if (!peek() || peek().t !== ')') throw new Error('Не закрыта скобка');
        eat();
        return v;
      }
      throw new Error('Здесь ожидалось число');
    }

    function sides() {
      const tk = peek();
      if (!tk || tk.t !== 'num') throw new Error('После d нужно число граней');
      eat();
      return tk.v;
    }

    function roll(count, faces) {
      count = Math.floor(count);
      faces = Math.floor(faces);
      if (count < 1 || faces < 2) throw new Error('Кубик должен быть хотя бы d2');
      if (count > MAX_DICE) throw new Error(`Не больше ${MAX_DICE} кубиков за раз`);
      if (faces > MAX_SIDES) throw new Error(`Не больше d${MAX_SIDES}`);
      const dice = [];
      let sum = 0;
      for (let i = 0; i < count; i++) {
        const v = 1 + Math.floor(Math.random() * faces);
        dice.push(v);
        sum += v;
      }
      rolls.push({ spec: `${count}d${faces}`, dice, sum });
      return sum;
    }

    const value = expr();
    if (pos < tokens.length) throw new Error('Лишнее в конце выражения');
    if (!Number.isFinite(value)) throw new Error('Получилось не число');
    return { value, rolls };
  }

  const format = (n) => Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, '');

  /* --- виджет калькулятора ----------------------------------------------- */

  const KEYS = [
    ['7', '8', '9', '÷'],
    ['4', '5', '6', '×'],
    ['1', '2', '3', '−'],
    ['(', ')', '.', '+'],
    ['C', '⌫', '='],          // «=» занимает две клетки, см. .is-wide
  ];
  const INSERT = { '÷': '/', '×': '*', '−': '-' };

  /** Собирает калькулятор. Возвращает готовый DOM-узел. */
  function widget() {
    const { el } = UI;

    const input = el('input', {
      class: 'field calc-display', type: 'text', inputmode: 'text',
      placeholder: '2d6+3', 'aria-label': 'Выражение',
    });
    const out = el('div', { class: 'calc-out' });
    const history = el('div', { class: 'calc-history' });
    const past = [];

    function show(text, kind) {
      out.className = 'calc-out' + (kind ? ' ' + kind : '');
      out.replaceChildren(text);
    }

    function run() {
      const src = input.value.trim();
      if (!src) return;
      let res;
      try {
        res = evaluate(src);
      } catch (err) {
        show(el('span', { class: 'calc-err', text: err.message }));
        return;
      }
      const detail = res.rolls.map((r) => `${r.spec}: ${r.dice.join(' + ')}`).join(' · ');
      show(el('div', {}, [
        el('div', { class: 'calc-value', text: format(res.value) }),
        detail ? el('div', { class: 'calc-detail', text: detail }) : null,
      ]));
      past.unshift({ src, value: format(res.value) });
      past.length = Math.min(past.length, 5);
      history.replaceChildren(...past.map((h) =>
        el('button', {
          class: 'calc-hist', title: 'Подставить обратно',
          onclick: () => { input.value = h.src; input.focus(); },
        }, [
          el('span', { class: 'ch-src', text: h.src }),
          el('span', { class: 'ch-val', text: h.value }),
        ])));
    }

    function press(key) {
      if (key === '=') return run();
      if (key === 'C') { input.value = ''; show(''); input.focus(); return; }
      if (key === '⌫') { input.value = input.value.slice(0, -1); input.focus(); return; }
      input.value += (INSERT[key] || key);
      input.focus();
    }

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); run(); }
    });

    const pad = el('div', { class: 'calc-pad' }, KEYS.flat().map((k) =>
      el('button', {
        class: 'btn calc-key'
          + (k === '=' ? ' btn-primary is-wide' : '')
          + ('C⌫'.includes(k) ? ' calc-key-soft' : ''),
        onclick: () => press(k), text: k,
      })));

    return el('div', { class: 'calc' }, [input, out, pad, history]);
  }

  /* --- виджет кубиков ----------------------------------------------------- */

  const DICE = [4, 6, 8, 10, 12, 20, 100];
  const SPIN_MS = 700;
  const TICK_MS = 70;
  const MAX_COUNT = 20;

  /** Выбор кубика и количества, бросок с анимацией. */
  function diceWidget() {
    const { el, icon } = UI;

    let die = 20;
    let count = 1;
    let timer = null;

    const faces = el('div', { class: 'dice-faces' }, DICE.map((d) =>
      el('button', {
        class: 'btn dice-face' + (d === die ? ' is-active' : ''),
        'aria-pressed': d === die ? 'true' : 'false',
        text: 'd' + d,
        onclick: (e) => {
          die = d;
          faces.querySelectorAll('.dice-face').forEach((b) => {
            const on = b.textContent === 'd' + d;
            b.classList.toggle('is-active', on);
            b.setAttribute('aria-pressed', on ? 'true' : 'false');
          });
          e.currentTarget.blur();
        },
      })));

    const countLabel = el('span', { class: 'dice-count-value', text: '1' });
    const setCount = (n) => {
      count = Math.min(MAX_COUNT, Math.max(1, n));
      countLabel.textContent = String(count);
    };
    const counter = el('div', { class: 'dice-count' }, [
      el('button', { class: 'btn btn-icon', title: 'Меньше кубиков', onclick: () => setCount(count - 1) }, [icon('minus', 18)]),
      countLabel,
      el('button', { class: 'btn btn-icon', title: 'Больше кубиков', onclick: () => setCount(count + 1) }, [icon('plus', 18)]),
    ]);

    const chips = el('div', { class: 'dice-chips' });
    const total = el('div', { class: 'dice-total' });
    const out = el('div', { class: 'dice-out' }, [chips, total]);

    const rollBtn = el('button', { class: 'btn btn-primary dice-roll', onclick: roll }, [
      icon('d20', 18), el('span', { text: 'Бросить' }),
    ]);

    function roll() {
      if (timer) { clearInterval(timer); timer = null; }
      // новый бросок стирает прошлые значения
      chips.replaceChildren();
      total.replaceChildren();

      const values = Array.from({ length: count }, () => 1 + Math.floor(Math.random() * die));
      const cells = values.map(() => el('span', { class: 'die-chip is-rolling', text: '?' }));
      chips.replaceChildren(...cells);

      const finish = () => {
        cells.forEach((c, i) => {
          c.textContent = String(values[i]);
          c.classList.remove('is-rolling');
          c.classList.add('is-settled');
          if (values[i] === die) c.classList.add('is-max');
          if (values[i] === 1) c.classList.add('is-min');
        });
        const sum = values.reduce((a, b) => a + b, 0);
        total.replaceChildren(el('span', { class: 'dice-sum', text: String(sum) }),
          el('span', { class: 'dice-sum-cap', text: `${count}d${die}` }));
        rollBtn.disabled = false;
        timer = null;
      };

      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return finish();

      rollBtn.disabled = true;
      const started = Date.now();
      timer = setInterval(() => {
        for (const c of cells) c.textContent = String(1 + Math.floor(Math.random() * die));
        if (Date.now() - started >= SPIN_MS) { clearInterval(timer); finish(); }
      }, TICK_MS);
    }

    return el('div', { class: 'dice' }, [
      faces,
      el('div', { class: 'dice-row' }, [counter, rollBtn]),
      out,
    ]);
  }

  return { evaluate, format, widget, diceWidget };
})();
