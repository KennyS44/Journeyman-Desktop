/* ==========================================================================
   zip.js — чтение и запись zip-архивов. Без сторонних библиотек: проект
   выкладывается статикой, сборки нет, лишний мегабайт зависимостей тут ни к
   чему.

   Файлы кладутся без сжатия (метод STORE). Внутри кодекса лежат картинки,
   видео и музыка — они уже сжаты своими форматами, и deflate отыграл бы
   считанные проценты в обмен на реализацию всего алгоритма. Текст рядом с
   ними весит пренебрежимо мало.

   Не поддерживается zip64: архив до 4 ГБ и до 65535 файлов. Для кодекса
   одного мастера этого хватает с большим запасом, а выход за границу
   заканчивается понятной ошибкой, а не битым файлом.
   ========================================================================== */

const ZIP = (() => {

  const LOCAL_SIG   = 0x04034b50;
  const CENTRAL_SIG = 0x02014b50;
  const EOCD_SIG    = 0x06054b50;
  const UTF8_FLAG   = 0x0800;          // имена файлов в UTF-8, а не в CP437
  const MAX_U32     = 0xffffffff;

  /* --- контрольная сумма -------------------------------------------------- */

  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
      t[i] = c >>> 0;
    }
    return t;
  })();

  function crc32(bytes) {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  /* --- время в формате MS-DOS --------------------------------------------- */

  /** Zip хранит время так, как его писала DOS: секунды с шагом в две. */
  function dosStamp(date) {
    const y = date.getFullYear();
    if (y < 1980 || y > 2107) return { time: 0, date: 0x21 };   // вне диапазона — 1 января 1980
    return {
      time: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1),
      date: ((y - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
    };
  }

  /* --- запись -------------------------------------------------------------- */

  /**
   * entries: [{ name: 'assets/x.bin', data: Uint8Array }]
   * Возвращает Uint8Array с готовым архивом.
   */
  function write(entries, when) {
    if (entries.length > 65535) throw new Error('Слишком много файлов для одного архива');

    const enc = new TextEncoder();
    const stamp = dosStamp(when || new Date());

    // сначала считаем размер: так архив собирается в один буфер без склеек
    const prepared = entries.map((e) => {
      const name = enc.encode(e.name);
      const data = e.data instanceof Uint8Array ? e.data : new Uint8Array(e.data);
      return { name, data, crc: crc32(data) };
    });

    let bodySize = 0, centralSize = 0;
    for (const p of prepared) {
      bodySize += 30 + p.name.length + p.data.length;
      centralSize += 46 + p.name.length;
    }
    if (bodySize + centralSize + 22 > MAX_U32) throw new Error('Архив больше 4 ГБ не поддерживается');

    const out = new Uint8Array(bodySize + centralSize + 22);
    const view = new DataView(out.buffer);
    let at = 0;

    const u16 = (v) => { view.setUint16(at, v, true); at += 2; };
    const u32 = (v) => { view.setUint32(at, v >>> 0, true); at += 4; };
    const raw = (b) => { out.set(b, at); at += b.length; };

    for (const p of prepared) {
      p.offset = at;
      u32(LOCAL_SIG);
      u16(20);                  // нужная версия распаковщика
      u16(UTF8_FLAG);
      u16(0);                   // метод: без сжатия
      u16(stamp.time); u16(stamp.date);
      u32(p.crc);
      u32(p.data.length);       // сжатый размер равен исходному
      u32(p.data.length);
      u16(p.name.length);
      u16(0);                   // поле extra не используется
      raw(p.name);
      raw(p.data);
    }

    const centralAt = at;
    for (const p of prepared) {
      u32(CENTRAL_SIG);
      u16(20);                  // версия, которой создан архив
      u16(20);
      u16(UTF8_FLAG);
      u16(0);
      u16(stamp.time); u16(stamp.date);
      u32(p.crc);
      u32(p.data.length);
      u32(p.data.length);
      u16(p.name.length);
      u16(0); u16(0);           // extra, комментарий
      u16(0);                   // номер диска
      u16(0); u32(0);           // атрибуты: внутренние, внешние
      u32(p.offset);
      raw(p.name);
    }

    // размер описи фиксируем до записи хвоста: при вычислении на месте
    // счётчик уже уехал бы вперёд на длину самого хвоста
    const centralSizeActual = at - centralAt;

    u32(EOCD_SIG);
    u16(0); u16(0);
    u16(prepared.length); u16(prepared.length);
    u32(centralSizeActual);
    u32(centralAt);
    u16(0);                     // комментарий к архиву

    return out;
  }

  /* --- чтение -------------------------------------------------------------- */

  /** Хвост архива ищется с конца: комментарий к нему может быть до 64 КБ. */
  function findEocd(view, len) {
    const from = Math.max(0, len - 22 - 0xffff);
    for (let i = len - 22; i >= from; i--) {
      if (view.getUint32(i, true) === EOCD_SIG) return i;
    }
    return -1;
  }

  /**
   * Разбирает архив. Возвращает Map: имя файла → Uint8Array.
   * Битую контрольную сумму считаем поводом отказаться: лучше честно сказать,
   * что файл испорчен, чем молча положить в кодекс мусор.
   */
  function read(bytes) {
    const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    if (data.length < 22) throw new Error('Это не архив: файл слишком мал');

    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const eocd = findEocd(view, data.length);
    if (eocd < 0) throw new Error('Это не zip-архив или он повреждён');

    const count = view.getUint16(eocd + 10, true);
    let at = view.getUint32(eocd + 16, true);
    const dec = new TextDecoder();
    const out = new Map();

    for (let i = 0; i < count; i++) {
      if (at + 46 > data.length || view.getUint32(at, true) !== CENTRAL_SIG) {
        throw new Error('Архив повреждён: сбита опись файлов');
      }
      const method  = view.getUint16(at + 10, true);
      const crc     = view.getUint32(at + 16, true);
      const size    = view.getUint32(at + 24, true);
      const nameLen = view.getUint16(at + 28, true);
      const extra   = view.getUint16(at + 30, true);
      const comment = view.getUint16(at + 32, true);
      const local   = view.getUint32(at + 42, true);
      const name    = dec.decode(data.subarray(at + 46, at + 46 + nameLen));
      at += 46 + nameLen + extra + comment;

      if (method !== 0) throw new Error(`Файл «${name}» сжат — такие архивы не читаются`);
      if (local + 30 > data.length || view.getUint32(local, true) !== LOCAL_SIG) {
        throw new Error(`Архив повреждён: не найден файл «${name}»`);
      }
      // длины полей берём из локального заголовка: они могут отличаться от описи
      const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
      if (start + size > data.length) throw new Error(`Архив обрывается на файле «${name}»`);

      const body = data.subarray(start, start + size);
      if (crc32(body) !== crc) throw new Error(`Файл «${name}» повреждён`);
      out.set(name, body);
    }

    return out;
  }

  return { write, read, crc32 };
})();

/* Тесты гоняются в node напрямую по этому файлу; в браузере строки ниже
   безвредны — module там не объявлен. */
if (typeof module !== 'undefined' && module.exports) module.exports = ZIP;
