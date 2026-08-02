/* ==========================================================================
   backup.js — кодекс целиком в один файл и обратно.

   Формат: обычный zip с расширением `.jm.zip`. Внутри `codex.json` с
   записями и папка `assets` с картинками, видео и музыкой как они есть.
   Архив открывается любым архиватором, то есть свои материалы мастер
   достанет и без этой программы — для хранилища, которое живёт только на
   его машине, это важнее компактности.

   Модуль знает только про DB, UI и ZIP, поэтому одинаково работает и над
   IndexedDB в браузере, и над файлами в настольной версии.
   ========================================================================== */

const BACKUP = (() => {
  const { toast, pickFiles, confirmDialog, plural, fmtSize } = UI;

  const FORMAT = 'journeyman-codex';
  const VERSION = 1;
  const ASSET_DIR = 'assets/';
  const BIG = 1024 * 1024 * 1024;      // порог, за которым честно предупреждаем

  let busy = false;                    // сборка большого кодекса идёт заметное время

  /* ======================================================================
     Сбор
     ====================================================================== */

  /** Пространства (целиком, со всеми потрохами) → описание + список файлов. */
  async function collect(spaces) {
    const files = [];
    const out = [];
    let bytes = 0;

    for (const space of spaces) {
      const nodes = await DB.listNodes(space.id);
      const links = await DB.listLinks(space.id);
      const packed = [];

      for (const node of nodes) {
        const assets = await DB.listAssets(node.id);
        const meta = [];
        for (const a of assets) {
          const path = ASSET_DIR + a.id + '.bin';
          files.push({ name: path, blob: a.blob });
          bytes += a.size || a.blob.size || 0;
          meta.push({ id: a.id, kind: a.kind, name: a.name, mime: a.mime, size: a.size, file: path });
        }
        packed.push({
          id: node.id, name: node.name, x: node.x, y: node.y,
          coverId: node.coverId || null,
          html: node.html != null ? node.html : null,
          text: node.text || '',
          notes: node.notes || [],
          createdAt: node.createdAt, updatedAt: node.updatedAt,
          assets: meta,
        });
      }

      out.push({
        id: space.id, name: space.name, description: space.description || '',
        scratch: space.scratch || '',
        createdAt: space.createdAt, updatedAt: space.updatedAt,
        nodes: packed,
        links: links.map((l) => ({ id: l.id, a: l.a, b: l.b, label: l.label || '', createdAt: l.createdAt })),
      });
    }

    return { spaces: out, files, bytes };
  }

  /** Имя файла, которое не поссорится с файловой системой. */
  function safeName(title) {
    const base = (title || 'кодекс').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
    const d = new Date();
    const stamp = [d.getFullYear(), d.getMonth() + 1, d.getDate()]
      .map((n) => String(n).padStart(2, '0')).join('-');
    return `${base || 'кодекс'} ${stamp}.jm.zip`;
  }

  async function build(spaces, title) {
    const { spaces: packed, files, bytes } = await collect(spaces);

    if (bytes > BIG) {
      const ok = await confirmDialog({
        title: 'Кодекс тяжёлый',
        description: `Материалов набралось на ${fmtSize(bytes)}. Файл собирается целиком в памяти — на слабой машине это может не получиться. Продолжить?`,
        confirm: 'Собирать',
        danger: false,
      });
      if (!ok) return null;
    }

    const codex = {
      format: FORMAT,
      version: VERSION,
      exportedAt: Date.now(),
      spaces: packed,
    };

    const entries = [{ name: 'codex.json', data: new TextEncoder().encode(JSON.stringify(codex, null, 1)) }];
    for (const f of files) entries.push({ name: f.name, data: new Uint8Array(await f.blob.arrayBuffer()) });

    return { bytes: ZIP.write(entries), name: safeName(title) };
  }

  async function save(spaces, title) {
    if (busy) return;
    if (!spaces.length) { toast('Сохранять пока нечего', 'err'); return; }
    busy = true;
    toast('Собираю файл…');
    try {
      const made = await build(spaces, title);
      if (!made) return;
      const done = await UI.saveFile(made.name, new Blob([made.bytes], { type: 'application/zip' }));
      if (done) toast(`Сохранено: ${made.name}`);
    } catch (err) {
      console.error(err);
      toast('Не удалось сохранить: ' + err.message, 'err');
    } finally {
      busy = false;
    }
  }

  const exportAll = async () => save(await DB.listSpaces(), 'Journeyman — весь кодекс');

  const exportSpace = async (spaceId) => {
    const space = await DB.getSpace(spaceId);
    if (space) await save([space], space.name);
  };

  /* ======================================================================
     Загрузка обратно
     ====================================================================== */

  /**
   * Картинки внутри текста ссылаются на файлы по data-asset. Идентификаторы
   * при загрузке выдаются новые, поэтому ссылки переписываются по карте.
   */
  function remapHtml(html, map) {
    if (!html) return html;
    const doc = new DOMParser().parseFromString(html, 'text/html');
    for (const img of doc.body.querySelectorAll('img[data-asset]')) {
      const next = map.get(img.dataset.asset);
      if (next) img.dataset.asset = next;
      else img.removeAttribute('data-asset');       // файл до архива не доехал
    }
    return doc.body.innerHTML;
  }

  function parse(zipMap) {
    const raw = zipMap.get('codex.json');
    if (!raw) throw new Error('внутри нет codex.json — похоже, это чужой архив');
    let codex;
    try { codex = JSON.parse(new TextDecoder().decode(raw)); }
    catch (_) { throw new Error('описание кодекса внутри архива испорчено'); }
    if (!codex || codex.format !== FORMAT) throw new Error('это архив не от Journeyman');
    if (!(codex.version <= VERSION)) throw new Error('файл сделан более новой версией программы');
    if (!Array.isArray(codex.spaces)) throw new Error('в архиве нет пространств');
    return codex;
  }

  /** Кладёт содержимое архива рядом с тем, что уже есть. Ничего не затирает. */
  async function apply(codex, zipMap) {
    const stat = { spaces: 0, nodes: 0, assets: 0, lost: 0 };

    for (const s of codex.spaces) {
      const space = await DB.createSpace(s.name || 'Без названия', s.description || '');
      if (s.scratch) await DB.updateSpace(space.id, { scratch: s.scratch });
      stat.spaces++;

      const nodeMap = new Map();

      for (const n of s.nodes || []) {
        const node = await DB.createNode(space.id, n.name || 'Без названия', n.x || 0, n.y || 0);
        nodeMap.set(n.id, node.id);
        stat.nodes++;

        const assetMap = new Map();
        for (const a of n.assets || []) {
          const body = zipMap.get(a.file);
          if (!body) { stat.lost++; continue; }
          // копия байтов: subarray смотрит в общий буфер архива, а File должен
          // пережить его освобождение
          const file = new File([body.slice()], a.name || 'без имени', { type: a.mime || '' });
          const saved = await DB.addAsset(node.id, file, a.kind || 'image');
          assetMap.set(a.id, saved.id);
          stat.assets++;
        }

        const patch = {
          text: n.text || '',
          notes: Array.isArray(n.notes) ? n.notes : [],
          coverId: (n.coverId && assetMap.get(n.coverId)) || null,
        };
        // у объекта без разметки поля html не было вовсе — не заводим его и
        // здесь, иначе загруженный кодекс отличался бы от исходного
        if (n.html != null) patch.html = remapHtml(n.html, assetMap);
        await DB.updateNode(node.id, patch);
      }

      for (const l of s.links || []) {
        const a = nodeMap.get(l.a), b = nodeMap.get(l.b);
        if (a && b) await DB.createLink(space.id, a, b, l.label || '');
      }
    }

    return stat;
  }

  async function importFile() {
    if (busy) return null;
    const files = await pickFiles('.zip,.jm.zip,application/zip', false);
    if (!files.length) return null;

    busy = true;
    toast('Читаю файл…');
    try {
      const zipMap = ZIP.read(new Uint8Array(await files[0].arrayBuffer()));
      const codex = parse(zipMap);

      const count = codex.spaces.length;
      const ok = await confirmDialog({
        title: 'Загрузить кодекс?',
        description: `В файле ${count} ${plural(count, 'пространство', 'пространства', 'пространств')}. `
          + 'Они встанут рядом с теми, что уже есть — ничего из нынешнего не пропадёт.',
        confirm: 'Загрузить',
        danger: false,
      });
      if (!ok) return null;

      const stat = await apply(codex, zipMap);
      const parts = [
        `${stat.spaces} ${plural(stat.spaces, 'пространство', 'пространства', 'пространств')}`,
        `${stat.nodes} ${plural(stat.nodes, 'объект', 'объекта', 'объектов')}`,
        `${stat.assets} ${plural(stat.assets, 'файл', 'файла', 'файлов')}`,
      ];
      toast('Загружено: ' + parts.join(', '));
      if (stat.lost) toast(`Не хватило файлов в архиве: ${stat.lost}`, 'err');
      return stat;
    } catch (err) {
      console.error(err);
      toast('Не удалось загрузить: ' + err.message, 'err');
      return null;
    } finally {
      busy = false;
    }
  }

  /* ======================================================================
     Меню настольной версии
     Пункты «Файл» дёргают те же действия, что и кнопки на экране. В браузере
     моста нет, условие не выполняется — и файл остаётся дословно одинаковым
     в обеих версиях.
     ====================================================================== */

  if (window.journeyman && window.journeyman.onCommand) {
    window.journeyman.onCommand(async (cmd) => {
      if (cmd === 'export') return exportAll();
      if (cmd === 'import' && await importFile()) APP.route();
    });
  }

  return { exportAll, exportSpace, importFile };
})();
