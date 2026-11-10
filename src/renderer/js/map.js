/* ==========================================================================
   map.js — классы объектов и карта под холстом пространства.

   Карта не хранится: она каждый раз строится из объектов. Страны, города и
   места дают сушу, страны делят её между собой границами, биом пространства
   задаёт краски и то, что растёт на земле. Всё рисуется кодом на <canvas>,
   без картинок и без сети — поэтому одинаково работает и в настольной версии.

   Модуль не знает про DB и экраны: на вход — список точек и биом, на выход —
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

  /* --- построение ------------------------------------------------------- */

  const PAD = 720;            // запас моря вокруг крайних объектов
  const MAX_PX = 2400000;     // предел пикселей холста — чтобы и телефон тянул
  const G = 4;                // шаг грубой сетки полей, в пикселях

  let job = 0;                // новая отрисовка отменяет недоделанную

  /**
   * items: [{ id, type, x, y, w, h }] — центр и размер карточки каждого объекта.
   * Возвращает размеры нарисованного в координатах холста или null, если
   * отрисовку обогнала следующая.
   */
  async function draw(canvas, { biome: key, seed, items }) {
    const my = ++job;
    const B = biomeOf(key);
    if (!B || !items.length) return null;

    const rand = rng(hashStr(seed || 'jm'));
    const fbm = makeNoise(rand);

    const geo = items.filter((it) => REACH[it.type]);
    const countries = geo.filter((it) => it.type === 'country');
    const reachK = B.reach || 1;
    const rough = B.rough || 0.28;

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const it of items) {
      minX = Math.min(minX, it.x - it.w / 2); maxX = Math.max(maxX, it.x + it.w / 2);
      minY = Math.min(minY, it.y - it.h / 2); maxY = Math.max(maxY, it.y + it.h / 2);
    }
    minX -= PAD; minY -= PAD; maxX += PAD; maxY += PAD;
    const W = maxX - minX, H = maxY - minY;
    const res = Math.min(1, Math.sqrt(MAX_PX / (W * H)));
    const cw = Math.ceil(W * res), ch = Math.ceil(H * res);

    /* грубая сетка: суша, высота, искривление границ */
    const gw = Math.ceil(cw / G) + 2, gh = Math.ceil(ch / G) + 2;
    const fLand = new Float32Array(gw * gh), fElev = new Float32Array(gw * gh);
    const fWx = new Float32Array(gw * gh), fWy = new Float32Array(gw * gh);
    for (let j = 0; j < gh; j++) {
      const Y = minY + (j * G) / res;
      for (let i = 0; i < gw; i++) {
        const X = minX + (i * G) / res;
        const k = j * gw + i;
        let land = 1;
        if (geo.length) {
          land = -1;
          for (const g of geo) {
            const v = 1 - Math.hypot(X - g.x, Y - g.y) / (REACH[g.type] * reachK);
            if (v > land) land = v;
          }
          land += fbm(X / 300, Y / 300) * rough;
          if (B.rough) land += fbm(X / 90 + 70, Y / 90) * 0.18;     // архипелаг дробится на острова
        }
        fLand[k] = land;
        fElev[k] = fbm(X / 220 + 40, Y / 220 - 13);
        fWx[k] = fbm(X / 400 + 91, Y / 400) * 110;
        fWy[k] = fbm(X / 400, Y / 400 + 57) * 110;
      }
    }

    const sample = (f, X, Y) => {
      const gx = Math.min(gw - 1.001, Math.max(0, ((X - minX) * res) / G));
      const gy = Math.min(gh - 1.001, Math.max(0, ((Y - minY) * res) / G));
      const i = Math.floor(gx), j = Math.floor(gy), u = gx - i, v = gy - j;
      const k = j * gw + i;
      return f[k] * (1 - u) * (1 - v) + f[k + 1] * u * (1 - v) + f[k + gw] * (1 - u) * v + f[k + gw + 1] * u * v;
    };

    /* попиксельная заливка — кусками, чтобы экран не замирал */
    const C = {
      deep: rgb(B.deep), shallow: rgb(B.shallow), low: rgb(B.low), high: rgb(B.high),
      coast: rgb(B.coast), border: rgb(B.border),
    };
    const tints = countries.map((_, i) => rgb(TINTS[i % TINTS.length]));
    // на светлой земле (снег, песок) оттенки стран кричат — приглушаем
    const tintK = (C.low[0] + C.low[1] + C.low[2]) / 3 > 150 ? 0.11 : 0.2;
    const grain = new Float32Array(128 * 128);
    for (let i = 0; i < grain.length; i++) grain[i] = rand() * 2 - 1;

    const img = new ImageData(cw, ch);
    const px = img.data;
    const rowsPerSlice = Math.max(8, Math.floor(200000 / cw));

    for (let y0 = 0; y0 < ch; y0 += rowsPerSlice) {
      await new Promise((r) => setTimeout(r, 0));
      if (my !== job) return null;
      const y1 = Math.min(ch, y0 + rowsPerSlice);
      for (let py = y0; py < y1; py++) {
        const gy = py / G, j = Math.floor(gy), v = gy - j;
        const Y = minY + (py + 0.5) / res;
        for (let pxi = 0; pxi < cw; pxi++) {
          const gx = pxi / G, i = Math.floor(gx), u = gx - i;
          const k = j * gw + i;
          const w00 = (1 - u) * (1 - v), w10 = u * (1 - v), w01 = (1 - u) * v, w11 = u * v;
          const bl = (f) => f[k] * w00 + f[k + 1] * w10 + f[k + gw] * w01 + f[k + gw + 1] * w11;
          const land = bl(fLand);
          const gr = grain[(py & 127) * 128 + (pxi & 127)];
          let col;
          if (land > 0) {
            col = mix(C.low, C.high, smooth(-0.35, 0.6, bl(fElev)));
            if (tints.length) {
              const X = minX + (pxi + 0.5) / res + bl(fWx);
              const Yw = Y + bl(fWy);
              let d1 = Infinity, d2 = Infinity, idx = 0;
              for (let c = 0; c < countries.length; c++) {
                const dx = X - countries[c].x, dy = Yw - countries[c].y;
                const d = dx * dx + dy * dy;
                if (d < d1) { d2 = d1; d1 = d; idx = c; } else if (d < d2) d2 = d;
              }
              col = mix(col, tints[idx], tintK);
              if (d2 !== Infinity) {
                const edge = Math.sqrt(d2) - Math.sqrt(d1);
                if (edge < 5) col = mix(col, C.border, 0.85);
                else if (edge < 16) col = mix(col, C.border, 0.15);
              }
            }
            if (land < 0.035) col = mix(col, C.coast, 0.75);
            const g = 1 + gr * 0.06;
            col = [col[0] * g, col[1] * g, col[2] * g];
          } else {
            col = mix(C.shallow, C.deep, smooth(0, 0.3, -land));
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
    ctx.setTransform(res, 0, 0, res, -minX * res, -minY * res);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    /* где значкам не место: под карточками и вокруг поселений */
    const keepOut = items.map((it) => {
      const r = it.type === 'city' ? 240 : it.type === 'place' ? 200 : 0;
      return { x: it.x, y: it.y, hw: Math.max(it.w / 2 + 24, r), hh: Math.max(it.h / 2 + 24, r) };
    });
    const free = (X, Y) => !keepOut.some((b) => Math.abs(X - b.x) < b.hw && Math.abs(Y - b.y) < b.hh);

    /* значки на суше и на воде */
    const S = B.step;
    for (let Y = minY + S / 2; Y < maxY; Y += S) {
      for (let X = minX + S / 2; X < maxX; X += S) {
        const x = X + (rand() - 0.5) * S * 0.8;
        const y = Y + (rand() - 0.5) * S * 0.8;
        const roll = rand(), size = S * 0.32 * (0.8 + rand() * 0.4);
        if (!free(x, y)) continue;
        const land = sample(fLand, x, y);
        if (land > 0.08) {
          const cluster = 0.6 + 0.6 * fbm(x / 160 + 5, y / 160 + 5);
          if (roll > B.density * cluster) continue;
          const elev = sample(fElev, x, y);
          GLYPHS[elev > 0.42 && B.glyph !== 'shroom' ? 'peak' : B.glyph](ctx, x, y, size, B, rand);
        } else if (land < -0.06 && roll < 0.12) {
          WATER[B.water](ctx, x, y, size, B, rand);
        }
      }
    }

    /* города и места поверх земли */
    for (const it of geo) {
      if (it.type === 'city') drawCity(ctx, it, B, rand);
      else if (it.type === 'place') drawPlace(ctx, it, B, rand);
    }

    return { x: minX, y: minY, w: W, h: H };
  }

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

  /** Город: стена кольцом и дома вокруг карточки. */
  function drawCity(ctx, it, B, r) {
    const g = ctx.createRadialGradient(it.x, it.y, 60, it.x, it.y, 240);
    g.addColorStop(0, 'rgba(0,0,0,.18)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(it.x, it.y, 240, 0, Math.PI * 2); ctx.fill();

    ctx.setLineDash([10, 6]);
    ctx.beginPath(); ctx.arc(it.x, it.y, 165, 0, Math.PI * 2);
    ctx.strokeStyle = B.border; ctx.lineWidth = 3; ctx.stroke();
    ctx.setLineDash([]);

    const n = 14;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + r() * 0.3;
      const d = 190 + r() * 34;
      const hx = it.x + Math.cos(a) * d, hy = it.y + Math.sin(a) * d;
      const s = 9 + r() * 4;
      ctx.fillStyle = B.border;
      ctx.fillRect(hx - s / 2, hy - s / 2, s, s * 0.8);
      shape(ctx, [hx - s * 0.65, hy - s / 2, hx, hy - s * 1.1, hx + s * 0.65, hy - s / 2], B.border, B.ink, 1.2);
    }
  }

  /** Место: круг стоячих камней. */
  function drawPlace(ctx, it, B, r) {
    const n = 10;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const hx = it.x + Math.cos(a) * 150, hy = it.y + Math.sin(a) * 135;
      const h = 14 + r() * 8;
      shape(ctx, [hx - 5, hy, hx - 4, hy - h, hx + 4, hy - h - 2, hx + 5, hy], B.border, B.ink, 1.4);
    }
  }

  return { CLASSES, classOf, BIOMES, biomeOf, draw, isGeo: (type) => !!REACH[type] };
})();
