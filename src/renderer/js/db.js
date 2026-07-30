/* ==========================================================================
   db.js — тот же интерфейс DB, что и в веб-версии, но поверх файлов на диске.
   Экраны (screens/*.js) не знают о подмене: имена методов, аргументы и форма
   ответа совпадают с браузерным вариантом на IndexedDB.

   Разница ровно одна и она внутри: записи и файлы лежат в папке программы,
   а обращение к ним идёт через мост preload → главный процесс.
   ========================================================================== */

const DB = (() => {
  const bridge = window.journeyman;
  if (!bridge) throw new Error('Мост к хранилищу недоступен: preload не загрузился');

  const call = (method, ...args) => bridge.db(method, ...args);

  /** Байты с диска → Blob, которого ждут экраны (галерея, плеер, обложки). */
  const withBlob = (asset) => {
    if (!asset) return null;
    const { bytes, ...meta } = asset;
    return { ...meta, blob: new Blob([bytes], { type: meta.mime }) };
  };

  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

  /* --- пространства, объекты, связи: прямой проброс ----------------------- */

  const listSpaces = () => call('listSpaces');
  const getSpace = (id) => call('getSpace', id);
  const createSpace = (name, description) => call('createSpace', name, description);
  const updateSpace = (id, patch) => call('updateSpace', id, patch);
  const deleteSpace = (id) => call('deleteSpace', id);
  const touchSpace = (id) => call('touchSpace', id);

  const listNodes = (spaceId) => call('listNodes', spaceId);
  const getNode = (id) => call('getNode', id);
  const createNode = (spaceId, name, x, y) => call('createNode', spaceId, name, x, y);
  const updateNode = (id, patch) => call('updateNode', id, patch);
  const deleteNode = (id) => call('deleteNode', id);

  const listLinks = (spaceId) => call('listLinks', spaceId);
  const createLink = (spaceId, a, b, label) => call('createLink', spaceId, a, b, label);
  const deleteLink = (id) => call('deleteLink', id);

  /* --- файлы --------------------------------------------------------------- */

  /**
   * File нельзя передать через мост целиком, поэтому содержимое читается здесь
   * и уходит байтами. Blob для показа собирается из тех же байтов — второго
   * чтения с диска не требуется.
   */
  async function addAsset(nodeId, file, kind) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const meta = await call('addAsset', nodeId, {
      name: file.name, mime: file.type, bytes,
    }, kind);
    return { ...meta, blob: new Blob([bytes], { type: meta.mime }) };
  }

  const getAsset = (id) => call('getAsset', id).then(withBlob);

  /**
   * Список файлов объекта вместе с содержимым: галерея и плеер ждут готовые
   * Blob'ы. Так же вела себя и версия на IndexedDB.
   */
  async function listAssets(nodeId) {
    const metas = await call('listAssets', nodeId);
    const full = await Promise.all(metas.map((m) => call('getAsset', m.id)));
    return full.filter(Boolean).map(withBlob);
  }

  const deleteAsset = (id) => call('deleteAsset', id);

  const estimate = () => call('estimate');

  return {
    uid,
    listSpaces, getSpace, createSpace, updateSpace, deleteSpace, touchSpace,
    listNodes, getNode, createNode, updateNode, deleteNode,
    listLinks, createLink, deleteLink,
    addAsset, listAssets, getAsset, deleteAsset,
    estimate,
  };
})();
