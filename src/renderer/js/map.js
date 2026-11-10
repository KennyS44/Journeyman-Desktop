/* ==========================================================================
   map.js — классы объектов и карта под холстом пространства.

   Карта хранится вместе с пространством как сетка зон. Первый раз она
   раскладывается по объектам (страны, города и места поднимают сушу, страны
   делят её границами), дальше мастер правит её кистью. Перемещение карточек
   карту не меняет. Биом задаёт краски и то, что растёт на земле. Всё рисуется
   кодом на <canvas>, без картинок и без сети — поэтому одинаково работает и
   в настольной версии.

   Модуль не знает про DB и экраны: на вход — сетка и биом, на выход —
   нарисованный холст.
   ========================================================================== */

const MAP = (() => {
  /* --- классы объектов -------------------------------------------------- */

  const CLASSES = [
    { key: 'country',   label: 'Страна',   icon: 'crown' },
    { key: 'city',      label: 'Город',    icon: 'castle' },
    { key: 'place',     label: 'Место',    icon: 'cave' },
    { key: 'character', label: 'Персонаж', icon: 'person' },
    { key: 'faction',   label: 'Фракция',  icon: 'banner' },
    { key: 'note',      label: 'Заметка',  icon: 'note' },
  ];
  const classOf = (key) => CLASSES.find((c) => c.key === key) || null;

  /** Сколько суши даёт объект вокруг себя (в единицах холста). */
  const REACH = { country: 560, city: 300, place: 230 };

  /* --- биомы ------------------------------------------------------------ */

  // deep/shallow — вода (у ада — лава, у подземья — бездна), low/high — суша
  // внизу и на возвышенностях, ink/fill/extra — краски значков на земле.
  const BIOMES = [
    { key: 'forest', label: 'Лес',
      deep: '#1e3443', shallow: '#35606e', low: '#56733a', high: '#3d5a2f', coast: '#233020', border: '#efe2b4',
      glyph: 'tree', ink: '#1f2c19', fill: '#3f6a32', extra: '#6f9a4a', water: 'wave', step: 46, density: 0.75 },
    { key: 'jungle', label: 'Джунгли',
      deep: '#0f3a3d', shallow: '#1f6660', low: '#2f6b2e', high: '#1f4d25', coast: '#14251a', border: '#f0e3a0',
      glyph: 'palm', ink: '#10230f', fill: '#3e8a3a', extra: '#7cbf55', water: 'wave', step: 44, density: 0.85 },
    { key: 'desert', label: 'Пустыня',
      deep: '#1f4a5e', shallow: '#3f8090', low: '#d4b277', high: '#b88d52', coast: '#7a5530', border: '#6e3a1c',
      glyph: 'dune', ink: '#8a6236', fill: '#c99e5e', extra: '#e8cf98', water: 'wave', step: 70, density: 0.5 },
    { key: 'steppe', label: 'Степь',
      deep: '#263f4c', shallow: '#46707a', low: '#a3a35c', high: '#7f8046', coast: '#4a4a2a', border: '#4b2e14',
      glyph: 'grass', ink: '#5a5a2c', fill: '#8a8a48', extra: '#c8c47a', water: 'wave', step: 52, density: 0.55 },
    { key: 'tundra', label: 'Тундра',
      deep: '#223648', shallow: '#4d6d84', low: '#cfd8db', high: '#a7b7bd', coast: '#5d7180', border: '#3b4d5e',
      glyph: 'snowpine', ink: '#2b3a35', fill: '#466b56', extra: '#f4f8fa', water: 'floe', step: 60, density: 0.45 },
    { key: 'swamp', label: 'Болота',
      deep: '#1e2a24', shallow: '#34442f', low: '#525d37', high: '#3e4729', coast: '#1d2416', border: '#dcd3a0',
      glyph: 'reed', ink: '#23291a', fill: '#6f7a3e', extra: '#2f3d33', water: 'wave', step: 48, density: 0.7 },
    { key: 'mountains', label: 'Горы',
      deep: '#22323f', shallow: '#3d5868', low: '#7f7667', high: '#5b534a', coast: '#2e2a25', border: '#efe2b4',
      glyph: 'peak', ink: '#2a2621', fill: '#8e8474', extra: '#eef0f0', water: 'wave', step: 58, density: 0.8 },
    { key: 'archipelago', label: 'Архипелаг',
      deep: '#0d4763', shallow: '#2a8ba0', low: '#cdb57d', high: '#5c8a45', coast: '#8a6b3a', border: '#3a2a12',
      glyph: 'palm', ink: '#2f3a1c', fill: '#4f8a3a', extra: '#8cc060', water: 'wave', step: 52, density: 0.5,
      reach: 0.62, rough: 0.5 },
    { key: 'hell', label: 'Преисподняя',
      deep: '#c2410e', shallow: '#5c1606', low: '#3b1b15', high: '#241009', coast: '#ff8a2a', border: '#f2a03c',
      glyph: 'shard', ink: '#120806', fill: '#2a1410', extra: '#ff7a1a', water: 'bubble', step: 54, density: 0.6 },
    { key: 'underdark', label: 'Подземье',
      deep: '#08070e', shallow: '#1b1731', low: '#2d2939', high: '#1d1a27', coast: '#6d5fc0', border: '#a99cf2',
      glyph: 'shroom', ink: '#0e0c14', fill: '#6a4fb0', extra: '#5fd3c0', water: 'spark', step: 56, density: 0.55 },
  ];
  const biomeOf = (key) => BIOMES.find((b) => b.key === key) || null;

  // оттенки, которыми страны отличаются друг от друга
  const TINTS = ['#e8c85a', '#c2503f', '#5b8bd0', '#9a5bc4', '#4fae73', '#d0702a', '#c25b9a', '#4fb0b8'];

  /* --- утилиты ---------------------------------------------------------- */

  const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const smooth = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };

  function hashStr(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function rng(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /** Плавный шум: одинаковый для одного и того же пространства. */
  function makeNoise(rand) {
    const P = new Uint8Array(256);
    const V = new Float32Array(256);
    for (let i = 0; i < 256; i++) { P[i] = i; V[i] = rand() * 2 - 1; }
    for (let i = 255; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [P[i], P[j]] = [P[j], P[i]]; }
    const h = (ix, iy) => V[P[(P[ix & 255] + iy) & 255]];
    function value(x, y) {
      const ix = Math.floor(x), iy = Math.floor(y);
      const fx = x - ix, fy = y - iy;
      const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
      const a = h(ix, iy), b = h(ix + 1, iy), c = h(ix, iy + 1), d = h(ix + 1, iy + 1);
      return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
    }
    return (x, y) => value(x, y) * 0.6 + value(x * 2.03 + 17, y * 2.03 + 9) * 0.3 + value(x * 4.1 + 31, y * 4.1 + 5) * 0.15;
  }

  /* --- карта как сетка зон ---------------------------------------------- */

  // Карта хранится, а не вычисляется заново: сетка клеток по CELL единиц
  // холста, в каждой — 0 (море), 1 (суша без хозяина) или 2+i (зона i).
  // Зона помнит, от какой страны она пошла, но живёт и без неё. Перемещение
  // карточек сетку не трогает; меняют её только кисть и «Перестроить».
  const CELL = 16;
  const CHUNK = CELL * 32;    // сетка растёт кусками, привязанными к началу холста
  const PAD = 720;            // запас моря вокруг крайних объектов
  const SEA = 0, LAND = 1;

  const floorTo = (v, k) => Math.floor(v / k) * k;
  const ceilTo = (v, k) => Math.ceil(v / k) * k;

  function blank(x0, y0, x1, y1, seed) {
    const ox = floorTo(x0, CHUNK), oy = floorTo(y0, CHUNK);
    const cols = (ceilTo(x1, CHUNK) - ox) / CELL, rows = (ceilTo(y1, CHUNK) - oy) / CELL;
    return { seed, ox, oy, cols, rows, zones: [], cells: new Uint8Array(cols * rows) };
  }

  /**
   * Первая раскладка по объектам: страны, города и места поднимают сушу,
   * страны делят её между собой. Дальше мастер правит её кистью.
   */
  function generate(items, seed, biomeKey) {
    if (!items.length) return null;
    const B = biomeOf(biomeKey) || {};
    let geo = items.filter((it) => REACH[it.type]);
    if (!geo.length) geo = items.map((it) => ({ ...it, type: 'city' }));    // хоть остров под карточками
    const countries = geo.filter((it) => it.type === 'country');
    const fbm = makeNoise(rng(hashStr(seed)));
    const reachK = B.reach || 1, rough = B.rough || 0.28;

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const it of items) {
      minX = Math.min(minX, it.x); maxX = Math.max(maxX, it.x);
      minY = Math.min(minY, it.y); maxY = Math.max(maxY, it.y);
    }
    const map = blank(minX - PAD, minY - PAD, maxX + PAD, maxY + PAD, seed);
    map.zones = countries.map((c) => c.id);

    for (let j = 0; j < map.rows; j++) {
      const Y = map.oy + (j + 0.5) * CELL;
      for (let i = 0; i < map.cols; i++) {
        const X = map.ox + (i + 0.5) * CELL;
        let land = -1;
        for (const g of geo) {
          const v = 1 - Math.hypot(X - g.x, Y - g.y) / (REACH[g.type] * reachK);
          if (v > land) land = v;
        }
        land += fbm(X / 300, Y / 300) * rough;
        if (B.rough) land += fbm(X / 90 + 70, Y / 90) * 0.18;
        if (land <= 0) continue;
        let v = LAND;
        if (countries.length) {
          const wx = X + fbm(X / 400 + 91, Y / 400) * 110, wy = Y + fbm(X / 400, Y / 400 + 57) * 110;
          let best = Infinity;
          countries.forEach((c, k) => {
            const d = (wx - c.x) ** 2 + (wy - c.y) ** 2;
            if (d < best) { best = d; v = 2 + k; }
          });
        }
        map.cells[j * map.cols + i] = v;
      }
    }
    return map;
  }

  /** Расширяет сетку так, чтобы в неё влез прямоугольник. Старые клетки не трогает. */
  function ensure(map, x0, y0, x1, y1) {
    const nx0 = Math.min(map.ox, floorTo(x0, CHUNK)), ny0 = Math.min(map.oy, floorTo(y0, CHUNK));
    const nx1 = Math.max(map.ox + map.cols * CELL, ceilTo(x1, CHUNK));
    const ny1 = Math.max(map.oy + map.rows * CELL, ceilTo(y1, CHUNK));
    const cols = (nx1 - nx0) / CELL, rows = (ny1 - ny0) / CELL;
    if (cols === map.cols && rows === map.rows) return false;
    const cells = new Uint8Array(cols * rows);
    const di = (map.ox - nx0) / CELL, dj = (map.oy - ny0) / CELL;
    for (let j = 0; j < map.rows; j++) {
      cells.set(map.cells.subarray(j * map.cols, (j + 1) * map.cols), (j + dj) * cols + di);
    }
    Object.assign(map, { ox: nx0, oy: ny0, cols, rows, cells });
    return true;
  }

  /** Мазок кистью радиуса r. value — SEA, LAND или 2+i. Возвращает true, если сетка выросла. */
  function paint(map, X, Y, r, value) {
    const grew = ensure(map, X - r - CELL, Y - r - CELL, X + r + CELL, Y + r + CELL);
    const i0 = Math.floor((X - r - map.ox) / CELL), i1 = Math.ceil((X + r - map.ox) / CELL);
    const j0 = Math.floor((Y - r - map.oy) / CELL), j1 = Math.ceil((Y + r - map.oy) / CELL);
    for (let j = Math.max(0, j0); j < Math.min(map.rows, j1); j++) {
      for (let i = Math.max(0, i0); i < Math.min(map.cols, i1); i++) {
        const cx = map.ox + (i + 0.5) * CELL, cy = map.oy + (j + 0.5) * CELL;
        if ((cx - X) ** 2 + (cy - Y) ** 2 <= r * r) map.cells[j * map.cols + i] = value;
      }
    }
    return grew;
  }

  /** Номер кисти для страны: если у неё ещё нет зоны — заводит. */
  function zoneValue(map, nodeId) {
    let k = map.zones.indexOf(nodeId);
    if (k < 0) { map.zones.push(nodeId); k = map.zones.length - 1; }
    return 2 + k;
  }

  /* хранение: клетки сжимаются в полосы одинаковых значений */
  function encode(map) {
    const runs = [];
    const c = map.cells;
    for (let k = 0; k < c.length;) {
      let n = 1;
      while (k + n < c.length && c[k + n] === c[k]) n++;
      runs.push(c[k].toString(36) + '.' + n.toString(36));
      k += n;
    }
    const { seed, ox, oy, cols, rows, zones } = map;
    return { v: 1, cell: CELL, seed, ox, oy, cols, rows, zones: zones.slice(), data: runs.join(',') };
  }

  function decode(stored) {
    if (!stored || stored.cell !== CELL || !stored.data) return null;
    const cells = new Uint8Array(stored.cols * stored.rows);
    let k = 0;
    for (const run of stored.data.split(',')) {
      const [v, n] = run.split('.').map((s) => parseInt(s, 36));
      cells.fill(v, k, k + n);
      k += n;
    }
    return { seed: stored.seed, ox: stored.ox, oy: stored.oy, cols: stored.cols, rows: stored.rows,
             zones: (stored.zones || []).slice(), cells };
  }

  /* --- отрисовка --------------------------------------------------------- */

  const MAX_PX = 2400000;     // предел пикселей холста — чтобы и телефон тянул
  let job = 0;                // новая отрисовка отменяет недоделанную

  /** Размытие по клеткам: из ступенчатой сетки — плавный берег. */
  function blur(src, cols, rows, r) {
    const tmp = new Float32Array(src.length), out = new Float32Array(src.length);
    const n = 2 * r + 1;
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        let s = 0;
        for (let d = -r; d <= r; d++) s += src[j * cols + Math.min(cols - 1, Math.max(0, i + d))];
        tmp[j * cols + i] = s / n;
      }
    }
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        let s = 0;
        for (let d = -r; d <= r; d++) s += tmp[Math.min(rows - 1, Math.max(0, j + d)) * cols + i];
        out[j * cols + i] = s / n;
      }
    }
    return out;
  }

  /** Рисует сохранённую карту. Возвращает её прямоугольник или null, если обогнали. */
  async function draw(canvas, { biome: key, map }) {
    const my = ++job;
    const B = biomeOf(key);
    if (!B || !map) return null;

    const { ox, oy, cols, rows, cells } = map;
    const W = cols * CELL, H = rows * CELL;
    const fbm = makeNoise(rng(hashStr(map.seed || 'jm')));
    const res = Math.min(1, Math.sqrt(MAX_PX / (W * H)));
    const cw = Math.ceil(W * res), ch = Math.ceil(H * res);

    /* поля в центрах клеток */
    const N = cols * rows;
    const solid = new Float32Array(N);
    for (let k = 0; k < N; k++) solid[k] = cells[k] ? 1 : 0;
    const fLand = blur(solid, cols, rows, 2);
    // у каждой зоны (и у ничьей суши) своё размытое поле: граница идёт там,
    // где два соседних поля равны, — плавной линией, а не ступеньками клеток
    const zoneField = [];
    for (let v = LAND; v < 2 + map.zones.length; v++) {
      const ind = new Float32Array(N);
      let any = false;
      for (let k = 0; k < N; k++) if (cells[k] === v) { ind[k] = 1; any = true; }
      zoneField[v] = any ? blur(ind, cols, rows, 2) : null;
    }
    const fNear = blur(solid, cols, rows, 7);
    const fCoast = new Float32Array(N), fElev = new Float32Array(N);
    const fWx = new Float32Array(N), fWy = new Float32Array(N);
    for (let j = 0; j < rows; j++) {
      const Y = oy + (j + 0.5) * CELL;
      for (let i = 0; i < cols; i++) {
        const X = ox + (i + 0.5) * CELL, k = j * cols + i;
        fCoast[k] = fbm(X / 260, Y / 260) * 0.2 + fbm(X / 60 + 11, Y / 60) * 0.08;
        fElev[k] = fbm(X / 220 + 40, Y / 220 - 13);
        fWx[k] = fbm(X / 150 + 91, Y / 150) * 22;
        fWy[k] = fbm(X / 150, Y / 150 + 57) * 22;
      }
    }

    const cellAt = (X, Y) => {
      const i = Math.floor((X - ox) / CELL), j = Math.floor((Y - oy) / CELL);
      if (i < 0 || j < 0 || i >= cols || j >= rows) return SEA;
      return cells[j * cols + i];
    };
    // билинейная выборка поля в точке холста
    const sampler = () => {
      let k = 0, w00 = 0, w10 = 0, w01 = 0, w11 = 0;
      const at = (X, Y) => {
        const gx = Math.min(cols - 1.001, Math.max(0, (X - ox) / CELL - 0.5));
        const gy = Math.min(rows - 1.001, Math.max(0, (Y - oy) / CELL - 0.5));
        const i = Math.floor(gx), j = Math.floor(gy), u = gx - i, v = gy - j;
        k = j * cols + i;
        w00 = (1 - u) * (1 - v); w10 = u * (1 - v); w01 = (1 - u) * v; w11 = u * v;
      };
      const get = (f) => f[k] * w00 + f[k + 1] * w10 + f[k + cols] * w01 + f[k + cols + 1] * w11;
      return { at, get, k: () => k };
    };
    const S1 = sampler();
    const landAt = (X, Y) => { S1.at(X, Y); return S1.get(fLand) + S1.get(fCoast); };

    const C = {
      deep: rgb(B.deep), shallow: rgb(B.shallow), low: rgb(B.low), high: rgb(B.high),
      coast: rgb(B.coast), border: rgb(B.border),
    };
    const tints = map.zones.map((_, i) => rgb(TINTS[i % TINTS.length]));
    // на светлой земле (снег, песок) оттенки стран кричат — приглушаем
    const tintK = (C.low[0] + C.low[1] + C.low[2]) / 3 > 150 ? 0.11 : 0.2;
    const grainRand = rng(hashStr((map.seed || 'jm') + 'grain'));
    const grain = new Float32Array(128 * 128);
    for (let i = 0; i < grain.length; i++) grain[i] = grainRand() * 2 - 1;

    const img = new ImageData(cw, ch);
    const px = img.data;
    const rowsPerSlice = Math.max(8, Math.floor(200000 / cw));
    const S = sampler();
    const Sw = sampler();
    const cand = [0, 0, 0, 0];

    for (let y0 = 0; y0 < ch; y0 += rowsPerSlice) {
      await new Promise((r) => setTimeout(r, 0));
      if (my !== job) return null;
      const y1 = Math.min(ch, y0 + rowsPerSlice);
      for (let py = y0; py < y1; py++) {
        const Y = oy + (py + 0.5) / res;
        for (let pxi = 0; pxi < cw; pxi++) {
          const X = ox + (pxi + 0.5) / res;
          S.at(X, Y);
          const land = S.get(fLand) + S.get(fCoast);
          // зерно привязано к месту на холсте, а не к краю карты
          const gr = grain[((Math.floor(Y) & 127) << 7) + (Math.floor(X) & 127)];
          let col;
          if (land > 0.5) {
            col = mix(C.low, C.high, smooth(-0.35, 0.6, S.get(fElev)));
            Sw.at(X + S.get(fWx), Y + S.get(fWy));
            const kk = Sw.k();
            cand[0] = cells[kk]; cand[1] = cells[kk + 1]; cand[2] = cells[kk + cols]; cand[3] = cells[kk + cols + 1];
            let z = 0, best = -1, second = -1;
            for (let c = 0; c < 4; c++) {
              const v = cand[c];
              if (!v || (c && cand.indexOf(v) < c)) continue;
              const f = Sw.get(zoneField[v]);
              if (f > best) { second = best; best = f; z = v; } else if (f > second) second = f;
            }
            if (!z) z = cellAt(X, Y) || LAND;
            if (z >= 2) col = mix(col, tints[z - 2], tintK);
            if (second >= 0) {
              const gap = best - second;
              if (gap < 0.05) col = mix(col, C.border, 0.85);
              else if (gap < 0.14) col = mix(col, C.border, 0.15);
            }
            if (land < 0.56) col = mix(col, C.coast, 0.75);
            const g = 1 + gr * 0.06;
            col = [col[0] * g, col[1] * g, col[2] * g];
          } else {
            col = mix(C.deep, C.shallow, smooth(0.02, 0.4, S.get(fNear)));
            const g = 1 + gr * 0.03;
            col = [col[0] * g, col[1] * g, col[2] * g];
          }
          const o = (py * cw + pxi) * 4;
          px[o] = col[0]; px[o + 1] = col[1]; px[o + 2] = col[2]; px[o + 3] = 255;
        }
      }
    }
    if (my !== job) return null;

    canvas.width = cw;
    canvas.height = ch;
    const ctx = canvas.getContext('2d');
    ctx.putImageData(img, 0, 0);
    ctx.setTransform(res, 0, 0, res, -ox * res, -oy * res);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    /* значки: сетка привязана к началу холста, случайность — к клетке,
       поэтому правка в одном углу не сдвигает лес в другом */
    const St = B.step;
    const seedH = hashStr(map.seed || 'jm');
    for (let gy = Math.floor(oy / St); gy * St < oy + H; gy++) {
      for (let gx = Math.floor(ox / St); gx * St < ox + W; gx++) {
        const r = rng(seedH ^ Math.imul(gx, 73856093) ^ Math.imul(gy, 19349663));
        const x = (gx + 0.5) * St + (r() - 0.5) * St * 0.8;
        const y = (gy + 0.5) * St + (r() - 0.5) * St * 0.8;
        const roll = r(), size = St * 0.32 * (0.8 + r() * 0.4);
        const land = landAt(x, y);
        if (land > 0.62) {
          const cluster = 0.6 + 0.6 * fbm(x / 160 + 5, y / 160 + 5);
          if (roll > B.density * cluster) continue;
          S1.at(x, y);
          const elev = S1.get(fElev);
          GLYPHS[elev > 0.42 && B.glyph !== 'shroom' ? 'peak' : B.glyph](ctx, x, y, size, B, r);
        } else if (land < 0.3 && roll < 0.12) {
          WATER[B.water](ctx, x, y, size, B, r);
        }
      }
    }

    return { x: ox, y: oy, w: W, h: H };
  }

  /** Быстрый просмотр зон для режима правки: одна точка — одна клетка. */
  function drawZones(canvas, map) {
    canvas.width = map.cols;
    canvas.height = map.rows;
    const ctx = canvas.getContext('2d');
    const img = ctx.createImageData(map.cols, map.rows);
    const tints = map.zones.map((_, i) => rgb(TINTS[i % TINTS.length]));
    for (let k = 0; k < map.cells.length; k++) {
      const v = map.cells[k];
      if (!v) continue;
      const c = v >= 2 ? tints[v - 2] : [255, 255, 255];
      img.data.set([c[0], c[1], c[2], v >= 2 ? 120 : 60], k * 4);
    }
    ctx.putImageData(img, 0, 0);
    return { x: map.ox, y: map.oy, w: map.cols * CELL, h: map.rows * CELL };
  }

  const tintOf = (map, nodeId) => {
    const k = map ? map.zones.indexOf(nodeId) : -1;
    return TINTS[(k < 0 ? (map ? map.zones.length : 0) : k) % TINTS.length];
  };

  /* --- значки ------------------------------------------------------------ */

  function shape(ctx, pts, fill, stroke, lw) {
    ctx.beginPath();
    ctx.moveTo(pts[0], pts[1]);
    for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
    ctx.closePath();
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw || 1.6; ctx.stroke(); }
  }
  function line(ctx, pts, stroke, lw) {
    ctx.beginPath();
    ctx.moveTo(pts[0], pts[1]);
    for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
    ctx.strokeStyle = stroke; ctx.lineWidth = lw || 1.6; ctx.stroke();
  }

  const GLYPHS = {
    tree(ctx, x, y, s, B) {
      line(ctx, [x, y, x, y - s * 0.5], B.ink, 2);
      ctx.beginPath(); ctx.arc(x, y - s * 0.85, s * 0.42, 0, Math.PI * 2);
      ctx.fillStyle = B.fill; ctx.fill(); ctx.strokeStyle = B.ink; ctx.lineWidth = 1.6; ctx.stroke();
      ctx.beginPath(); ctx.arc(x - s * 0.12, y - s * 0.97, s * 0.16, 0, Math.PI * 2);
      ctx.fillStyle = B.extra; ctx.fill();
    },
    palm(ctx, x, y, s, B, r) {
      const lean = (r() - 0.5) * s * 0.6;
      const tx = x + lean, ty = y - s * 1.1;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.quadraticCurveTo(x, y - s * 0.6, tx, ty);
      ctx.strokeStyle = B.ink; ctx.lineWidth = 2.2; ctx.stroke();
      for (const a of [-2.6, -1.9, -1.2, -0.5]) {
        const ex = tx + Math.cos(a) * s * 0.7, ey = ty + Math.sin(a) * s * 0.4 + s * 0.25;
        ctx.beginPath(); ctx.moveTo(tx, ty);
        ctx.quadraticCurveTo(tx + Math.cos(a) * s * 0.4, ty - s * 0.25, ex, ey);
        ctx.strokeStyle = B.fill; ctx.lineWidth = 3; ctx.stroke();
      }
      ctx.beginPath(); ctx.arc(tx, ty, s * 0.12, 0, Math.PI * 2); ctx.fillStyle = B.extra; ctx.fill();
    },
    dune(ctx, x, y, s, B) {
      ctx.beginPath(); ctx.moveTo(x - s, y);
      ctx.quadraticCurveTo(x - s * 0.2, y - s * 0.7, x + s, y);
      ctx.strokeStyle = B.ink; ctx.lineWidth = 1.6; ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x - s * 0.5, y + s * 0.35);
      ctx.quadraticCurveTo(x + s * 0.1, y - s * 0.1, x + s * 0.7, y + s * 0.35);
      ctx.strokeStyle = B.extra; ctx.lineWidth = 1.4; ctx.stroke();
    },
    grass(ctx, x, y, s, B) {
      line(ctx, [x - s * 0.3, y - s * 0.55, x, y, x, y - s * 0.75], B.ink, 1.5);
      line(ctx, [x, y, x + s * 0.32, y - s * 0.5], B.ink, 1.5);
      line(ctx, [x + s * 0.5, y + s * 0.1, x + s * 0.65, y - s * 0.3], B.extra, 1.3);
    },
    snowpine(ctx, x, y, s, B) {
      line(ctx, [x, y, x, y - s * 0.25], B.ink, 2);
      shape(ctx, [x, y - s * 1.25, x - s * 0.45, y - s * 0.2, x + s * 0.45, y - s * 0.2], B.fill, B.ink, 1.4);
      shape(ctx, [x, y - s * 1.25, x - s * 0.2, y - s * 0.8, x + s * 0.2, y - s * 0.8], B.extra, null);
    },
    reed(ctx, x, y, s, B) {
      ctx.beginPath(); ctx.ellipse(x, y + s * 0.1, s * 0.8, s * 0.22, 0, 0, Math.PI * 2);
      ctx.fillStyle = B.extra; ctx.fill();
      for (const dx of [-0.35, 0, 0.3]) {
        const h = s * (0.8 + Math.abs(dx));
        line(ctx, [x + dx * s, y, x + dx * s * 1.2, y - h], B.ink, 1.4);
        ctx.beginPath(); ctx.ellipse(x + dx * s * 1.2, y - h, s * 0.07, s * 0.18, 0, 0, Math.PI * 2);
        ctx.fillStyle = B.ink; ctx.fill();
      }
    },
    peak(ctx, x, y, s, B) {
      const k = 1.3;
      shape(ctx, [x - s * 0.8 * k, y, x, y - s * 1.1 * k, x + s * 0.8 * k, y], B.fill || B.high, B.ink, 1.6);
      shape(ctx, [x, y - s * 1.1 * k, x + s * 0.8 * k, y, x + s * 0.15 * k, y], 'rgba(0,0,0,.22)', null);
      if (B.key === 'mountains' || B.key === 'tundra') {
        shape(ctx, [x, y - s * 1.1 * k, x - s * 0.28 * k, y - s * 0.72 * k, x, y - s * 0.8 * k, x + s * 0.25 * k, y - s * 0.74 * k], B.extra, null);
      }
    },
    shard(ctx, x, y, s, B, r) {
      if (r() < 0.4) {                 // трещина с лавой
        line(ctx, [x - s, y, x - s * 0.3, y - s * 0.3, x + s * 0.2, y + s * 0.1, x + s, y - s * 0.2], B.extra, 2);
        return;
      }
      shape(ctx, [x - s * 0.35, y, x - s * 0.1, y - s * 1.3, x + s * 0.15, y], B.fill, B.extra, 1.2);
      shape(ctx, [x + s * 0.05, y, x + s * 0.35, y - s * 0.8, x + s * 0.5, y], B.fill, B.extra, 1.2);
    },
    shroom(ctx, x, y, s, B, r) {
      if (r() < 0.35) {                // кристалл
        shape(ctx, [x, y - s * 1.1, x + s * 0.3, y - s * 0.45, x, y, x - s * 0.3, y - s * 0.45], B.extra, B.ink, 1.2);
        return;
      }
      ctx.fillStyle = '#bfb6d6';
      ctx.fillRect(x - s * 0.08, y - s * 0.6, s * 0.16, s * 0.6);
      ctx.beginPath(); ctx.ellipse(x, y - s * 0.6, s * 0.45, s * 0.3, 0, Math.PI, 0);
      ctx.closePath(); ctx.fillStyle = B.fill; ctx.fill();
      ctx.strokeStyle = B.ink; ctx.lineWidth = 1.2; ctx.stroke();
    },
  };

  const WATER = {
    wave(ctx, x, y, s, B) {
      ctx.beginPath();
      ctx.moveTo(x - s, y);
      ctx.quadraticCurveTo(x - s * 0.5, y - s * 0.4, x, y);
      ctx.quadraticCurveTo(x + s * 0.5, y - s * 0.4, x + s, y);
      ctx.strokeStyle = 'rgba(255,255,255,.22)'; ctx.lineWidth = 1.6; ctx.stroke();
    },
    floe(ctx, x, y, s) {
      shape(ctx, [x - s * 0.6, y, x - s * 0.2, y - s * 0.4, x + s * 0.5, y - s * 0.3, x + s * 0.6, y + s * 0.2, x, y + s * 0.3],
        'rgba(240,246,250,.75)', null);
    },
    bubble(ctx, x, y, s) {
      ctx.beginPath(); ctx.arc(x, y, s * 0.3, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255,214,120,.7)'; ctx.lineWidth = 1.6; ctx.stroke();
      ctx.beginPath(); ctx.arc(x + s * 0.5, y + s * 0.3, s * 0.14, 0, Math.PI * 2); ctx.stroke();
    },
    spark(ctx, x, y, s) {
      ctx.fillStyle = 'rgba(190,175,255,.55)';
      ctx.fillRect(x, y, 2, 2);
      ctx.fillRect(x + s * 0.6, y - s * 0.4, 1.5, 1.5);
    },
  };


  /* --- города и места -----------------------------------------------------
     Рисуются не на карте, а слоем вместе с карточкой: передвинули город —
     стена поехала за ним, а сама карта осталась как была. */

  function decor(it, B) {
    const NS = 'http://www.w3.org/2000/svg';
    const g = document.createElementNS(NS, 'g');
    g.setAttribute('class', 'map-decor');
    const mk = (tag, attrs) => {
      const e = document.createElementNS(NS, tag);
      for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
      g.append(e);
    };
    const r = rng(hashStr(it.id));
    if (it.type === 'city') {
      mk('circle', { cx: it.x, cy: it.y, r: 165, fill: 'none', stroke: B.border, 'stroke-width': 3, 'stroke-dasharray': '10 6' });
      const n = 14;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + r() * 0.3;
        const d = 190 + r() * 34, s = 9 + r() * 4;
        const hx = it.x + Math.cos(a) * d, hy = it.y + Math.sin(a) * d;
        mk('path', {
          d: `M${hx - s / 2} ${hy + s * 0.3}V${hy - s / 2}L${hx} ${hy - s * 1.1}L${hx + s / 2} ${hy - s / 2}V${hy + s * 0.3}Z`,
          fill: B.border, stroke: B.ink, 'stroke-width': 1.2,
        });
      }
    } else if (it.type === 'place') {
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2;
        const hx = it.x + Math.cos(a) * 150, hy = it.y + Math.sin(a) * 135, h = 14 + r() * 8;
        mk('path', { d: `M${hx - 5} ${hy}L${hx - 4} ${hy - h}L${hx + 4} ${hy - h - 2}L${hx + 5} ${hy}Z`, fill: B.border, stroke: B.ink, 'stroke-width': 1.4 });
      }
    } else {
      return null;
    }
    return g;
  }

  return {
    CLASSES, classOf, BIOMES, biomeOf, isGeo: (type) => !!REACH[type],
    generate, blank, paint, zoneValue, encode, decode, draw, drawZones, decor, tintOf, SEA, LAND,
  };
})();
