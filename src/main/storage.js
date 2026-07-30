/* ==========================================================================
   storage.js — хранилище десктопной версии.
   Записи (пространства, объекты, связи, метаданные файлов) лежат в одном
   db.json, сами файлы — отдельными файлами в assets/. Ни браузера, ни
   IndexedDB: обычная папка, которую можно скопировать и унести с собой.

   Модуль чистый: не знает про Electron и IPC, принимает путь к папке
   данных. Благодаря этому тесты гоняют его во временном каталоге.
   ========================================================================== */

const fs = require('fs');
const path = require('path');

const EMPTY = { version: 1, spaces: {}, nodes: {}, links: {}, assets: {} };

function createStorage(dataDir) {
  const dbFile = path.join(dataDir, 'db.json');
  const assetsDir = path.join(dataDir, 'assets');

  fs.mkdirSync(assetsDir, { recursive: true });

  let db = load();

  function load() {
    try {
      const raw = fs.readFileSync(dbFile, 'utf8');
      const parsed = JSON.parse(raw);
      // недостающие разделы достраиваем: файл мог остаться от прошлой версии
      return { ...structuredClone(EMPTY), ...parsed };
    } catch (err) {
      if (err.code === 'ENOENT') return structuredClone(EMPTY);
      // испорченный файл не затираем молча — отводим в сторону и начинаем чисто
      const backup = dbFile + '.broken-' + Date.now();
      try { fs.renameSync(dbFile, backup); } catch (_) {}
      const e = new Error(`Файл данных повреждён и сохранён как ${path.basename(backup)}`);
      e.recovered = true;
      console.error(e.message, err);
      return structuredClone(EMPTY);
    }
  }

  /** Запись целиком и атомарно: сначала во временный файл, потом переименование. */
  function save() {
    const tmp = dbFile + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(db), 'utf8');
    fs.renameSync(tmp, dbFile);
  }

  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const assetPath = (id) => path.join(assetsDir, id + '.bin');

  /* --- пространства ------------------------------------------------------ */

  const listSpaces = () =>
    Object.values(db.spaces).sort((a, b) => b.updatedAt - a.updatedAt);

  const getSpace = (id) => db.spaces[id] || null;

  function createSpace(name, description) {
    const now = Date.now();
    const space = { id: uid(), name, description: description || '', createdAt: now, updatedAt: now };
    db.spaces[space.id] = space;
    save();
    return space;
  }

  function updateSpace(id, patch) {
    const cur = db.spaces[id];
    if (!cur) return null;
    const next = { ...cur, ...patch, updatedAt: Date.now() };
    db.spaces[id] = next;
    save();
    return next;
  }

  const touchSpace = (id) => updateSpace(id, {});

  function deleteSpace(id) {
    for (const node of Object.values(db.nodes)) {
      if (node.spaceId === id) deleteNode(node.id, { skipSave: true, skipTouch: true });
    }
    for (const link of Object.values(db.links)) {
      if (link.spaceId === id) delete db.links[link.id];
    }
    delete db.spaces[id];
    save();
  }

  /* --- ключевые объекты -------------------------------------------------- */

  const listNodes = (spaceId) => Object.values(db.nodes).filter((n) => n.spaceId === spaceId);

  const getNode = (id) => db.nodes[id] || null;

  function createNode(spaceId, name, x, y) {
    const now = Date.now();
    const node = {
      id: uid(), spaceId, name, x, y,
      coverId: null, text: '', html: '', notes: [],
      createdAt: now, updatedAt: now,
    };
    db.nodes[node.id] = node;
    save();
    touchSpace(spaceId);
    return node;
  }

  function updateNode(id, patch) {
    const cur = db.nodes[id];
    if (!cur) return null;
    const next = { ...cur, ...patch, updatedAt: Date.now() };
    db.nodes[id] = next;
    save();
    return next;
  }

  function deleteNode(id, opts = {}) {
    const node = db.nodes[id];
    if (!node) return;
    for (const asset of Object.values(db.assets)) {
      if (asset.nodeId === id) removeAssetFile(asset.id);
    }
    for (const link of Object.values(db.links)) {
      if (link.a === id || link.b === id) delete db.links[link.id];
    }
    delete db.nodes[id];
    if (!opts.skipSave) save();
    if (!opts.skipTouch) touchSpace(node.spaceId);
  }

  /* --- связи ------------------------------------------------------------- */

  const listLinks = (spaceId) => Object.values(db.links).filter((l) => l.spaceId === spaceId);

  function createLink(spaceId, a, b, label) {
    if (a === b) return null;
    const dup = listLinks(spaceId).find((l) => (l.a === a && l.b === b) || (l.a === b && l.b === a));
    if (dup) return dup;
    const link = { id: uid(), spaceId, a, b, label: label || '', createdAt: Date.now() };
    db.links[link.id] = link;
    save();
    touchSpace(spaceId);
    return link;
  }

  function deleteLink(id) {
    delete db.links[id];
    save();
  }

  /* --- файлы ------------------------------------------------------------- */

  /** Принимает уже прочитанные байты: renderer не умеет отдавать File через IPC. */
  function addAsset(nodeId, file, kind) {
    const asset = {
      id: uid(), nodeId, kind,
      name: file.name || 'без имени',
      mime: file.mime || 'application/octet-stream',
      size: file.bytes.length,
      createdAt: Date.now(),
    };
    fs.writeFileSync(assetPath(asset.id), Buffer.from(file.bytes));
    db.assets[asset.id] = asset;
    save();
    return asset;
  }

  const listAssets = (nodeId) =>
    Object.values(db.assets).filter((a) => a.nodeId === nodeId).sort((a, b) => a.createdAt - b.createdAt);

  /** Метаданные вместе с содержимым файла — форма, ожидаемая экранами. */
  function getAsset(id) {
    const meta = db.assets[id];
    if (!meta) return null;
    let bytes;
    try {
      bytes = fs.readFileSync(assetPath(id));
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
      return null;                       // запись есть, файла нет — считаем удалённым
    }
    return { ...meta, bytes };
  }

  function removeAssetFile(id) {
    try { fs.unlinkSync(assetPath(id)); } catch (_) {}
    delete db.assets[id];
  }

  function deleteAsset(id) {
    removeAssetFile(id);
    save();
  }

  /* --- служебное --------------------------------------------------------- */

  /** Сколько места занято данными: аналог navigator.storage.estimate. */
  function estimate() {
    let usage = 0;
    try { usage += fs.statSync(dbFile).size; } catch (_) {}
    for (const name of fs.readdirSync(assetsDir)) {
      try { usage += fs.statSync(path.join(assetsDir, name)).size; } catch (_) {}
    }
    return { usage, quota: null, dataDir };
  }

  return {
    dataDir, uid,
    listSpaces, getSpace, createSpace, updateSpace, deleteSpace, touchSpace,
    listNodes, getNode, createNode, updateNode, deleteNode,
    listLinks, createLink, deleteLink,
    addAsset, listAssets, getAsset, deleteAsset,
    estimate,
  };
}

module.exports = { createStorage };
