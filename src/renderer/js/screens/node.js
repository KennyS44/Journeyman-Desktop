/* ==========================================================================
   screens/node.js — экран #/n/<id> : внутренняя директория объекта.
   Текст с таблицами и картинками, боковые панели, свиток плана.
   ========================================================================== */

const NODE = (() => {
  const { el, icon, toast, formDialog, confirmDialog, chooseDialog, lightbox, pickFiles,
          blobUrl, sanitizeHtml, textToHtml, fmtDate, fmtSize, plural, debounce } = UI;
  const { root, go, topbar, clamp, playTrack, setTeardown } = APP;

  /* ======================================================================
     Свиток плана
     Один и тот же узел переезжает между объектами одного плана, поэтому
     заметка остаётся на месте: не мигает, не теряет позицию прокрутки и
     не сбрасывает несохранённый текст. При смене плана строится заново.
     ====================================================================== */

  let scratchCache = null;     // { spaceId, root, area }
  let scratchHost = null;      // текущий .detail-body, на нём живёт класс

  function setScratchOpen(on) {
    if (scratchHost) scratchHost.classList.toggle('scratch-open', on);
    if (!scratchCache) return;
    try { localStorage.setItem('jm.scratch.' + scratchCache.spaceId, on ? '1' : '0'); } catch (_) {}
  }

  /** Был ли свиток открыт в прошлый раз. Запрет хранилища — просто «закрыт». */
  function scratchWasOpen(spaceId) {
    try { return localStorage.getItem('jm.scratch.' + spaceId) === '1'; } catch (_) { return false; }
  }

  function scratchPanel(space) {
    if (scratchCache && scratchCache.spaceId === space.id) return scratchCache;

    const area = el('textarea', {
      class: 'scratch-text', 'aria-label': 'Заметки плана',
      placeholder: 'Общее для всего плана: состав партии, инициатива, чем кончилась прошлая сцена…',
    });
    area.value = space.scratch || '';
    const saveScratch = debounce((v) => DB.updateSpace(space.id, { scratch: v }), 500);
    area.addEventListener('input', () => saveScratch(area.value));

    const panelRoot = el('section', { class: 'scratch' }, [
      el('button', { class: 'scratch-tab', title: 'Заметки плана', onclick: () => setScratchOpen(true) }, [
        icon('note', 18),
        el('span', { class: 'scratch-tab-label', text: 'Заметки плана' }),
      ]),
      el('div', { class: 'scratch-body' }, [
        el('div', { class: 'scratch-head' }, [
          el('h2', { class: 'scratch-title', text: 'Заметки плана' }),
          el('span', { class: 'topbar-spacer' }),
          el('button', { class: 'btn btn-ghost btn-icon', title: 'Свернуть', onclick: () => setScratchOpen(false) }, [icon('close', 18)]),
        ]),
        el('p', { class: 'scratch-hint', text: space.name }),
        area,
      ]),
    ]);

    scratchCache = { spaceId: space.id, root: panelRoot, area };
    return scratchCache;
  }

  /* ======================================================================
     Экран объекта
     ====================================================================== */

  async function render(nodeId) {
    const node = await DB.getNode(nodeId);
    if (!node) { toast('Объект не найден', 'err'); return MENU.render(); }
    const space = await DB.getSpace(node.spaceId);
    document.title = node.name + ' — Journeyman';

    let assets = await DB.listAssets(node.id);
    const links = await DB.listLinks(node.spaceId);
    const siblings = await DB.listNodes(node.spaceId);

    /* --- основной документ: текст с таблицами и картинками --------------- */

    const title = el('input', { class: 'doc-title', value: node.name, 'aria-label': 'Наименование объекта' });
    const meta = el('div', { class: 'doc-meta' });
    const saveStatus = el('span', { class: 'topbar-sub', text: '' });

    const editor = el('div', {
      class: 'doc-text', contenteditable: 'true', role: 'textbox', 'aria-multiline': 'true',
      'aria-label': 'Текст объекта',
      'data-placeholder': 'Здесь живёт всё, что нужно помнить: описание места, реплики NPC, тайны, зацепки, статблоки…',
    });
    // старые записи хранились простым текстом — переносим их в разметку на лету
    editor.innerHTML = sanitizeHtml(node.html != null ? node.html : textToHtml(node.text));
    await hydrateImages(editor);

    /** Подставляет картинкам ссылки на файлы из хранилища. */
    async function hydrateImages(where) {
      for (const img of where.querySelectorAll('img[data-asset]')) {
        const a = await DB.getAsset(img.dataset.asset);
        if (a) img.src = blobUrl(a.blob);
        else img.replaceWith(el('span', { class: 'img-missing', text: '⟨изображение удалено⟩' }));
      }
    }

    /** Разметка для хранения: ссылки на файлы живут только в памяти. */
    function serialize() {
      const clone = editor.cloneNode(true);
      clone.querySelectorAll('img[data-asset]').forEach((i) => i.removeAttribute('src'));
      return clone.innerHTML;
    }

    function updateEmpty() {
      const blank = !editor.textContent.trim() && !editor.querySelector('img, table');
      editor.classList.toggle('is-empty', blank);
    }

    const saveDoc = debounce(async () => {
      const html = serialize();
      // contenteditable ставит неразрывные пробелы — в простой копии текста
      // они не нужны: по ней считаются слова и её увидит будущий экспорт
      const plain = editor.innerText.replace(/\u00a0/g, ' ').trim();
      node.html = html;
      node.text = plain;
      await DB.updateNode(node.id, { html, text: plain });
      await DB.touchSpace(node.spaceId);
      refreshMeta();
      saveStatus.textContent = 'сохранено';
      setTimeout(() => { if (saveStatus.textContent === 'сохранено') saveStatus.textContent = ''; }, 1600);
    }, 500);

    function onEdit() {
      updateEmpty();
      saveStatus.textContent = 'сохраняю…';
      saveDoc();
    }
    editor.addEventListener('input', onEdit);

    const save = debounce(async (patch) => {
      await DB.updateNode(node.id, patch);
      await DB.touchSpace(node.spaceId);
      saveStatus.textContent = 'сохранено';
      setTimeout(() => { if (saveStatus.textContent === 'сохранено') saveStatus.textContent = ''; }, 1600);
    }, 500);

    title.addEventListener('input', () => {
      node.name = title.value;
      saveStatus.textContent = 'сохраняю…';
      save({ name: title.value.trim() || 'Без названия' });
    });

    /* --- запоминание места ввода (кнопки не должны его терять) ----------- */

    let savedRange = null;
    const rememberRange = () => {
      const sel = window.getSelection();
      if (sel && sel.rangeCount && editor.contains(sel.anchorNode)) {
        savedRange = sel.getRangeAt(0).cloneRange();
      }
    };
    document.addEventListener('selectionchange', rememberRange);

    function focusEditor() {
      editor.focus();
      if (!savedRange) return;
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(savedRange);
    }
    // execCommand иногда оставляет <p></p> нулевой высоты — в такой абзац
    // невозможно поставить курсор, поэтому даём ему перенос строки
    const fixEmptyParagraphs = () => {
      editor.querySelectorAll('p:empty').forEach((p) => p.append(document.createElement('br')));
    };
    const exec = (cmd, val) => {
      focusEditor();
      document.execCommand(cmd, false, val);
      fixEmptyParagraphs();
      onEdit();
    };
    const insertHtml = (html) => {
      focusEditor();
      document.execCommand('insertHTML', false, html);
      fixEmptyParagraphs();
      onEdit();
    };

    // вставка из буфера: чистим разметку, чтобы не тащить чужие стили и скрипты
    editor.addEventListener('paste', (e) => {
      const html = e.clipboardData.getData('text/html');
      const text = e.clipboardData.getData('text/plain');
      e.preventDefault();
      if (html) document.execCommand('insertHTML', false, sanitizeHtml(html));
      else document.execCommand('insertText', false, text);
      onEdit();
    });

    /* --- таблицы --------------------------------------------------------- */

    function currentCell() {
      const anchor = savedRange ? savedRange.startContainer : null;
      if (!anchor || !editor.contains(anchor)) return null;
      const e = anchor.nodeType === 1 ? anchor : anchor.parentElement;
      return e ? e.closest('td, th') : null;
    }

    function tableHtml(rows, cols) {
      let h = '<table><thead><tr>';
      for (let c = 0; c < cols; c++) h += `<th>Столбец ${c + 1}</th>`;
      h += '</tr></thead><tbody>';
      for (let r = 0; r < rows; r++) {
        h += '<tr>' + '<td><br></td>'.repeat(cols) + '</tr>';
      }
      return h + '</tbody></table><p><br></p>';
    }

    async function newTable() {
      const v = await formDialog({
        title: 'Новая таблица',
        description: 'Шапку и ячейки можно править прямо в тексте.',
        fields: [
          { key: 'rows', label: 'Строк (без шапки)', value: '3' },
          { key: 'cols', label: 'Столбцов', value: '3' },
        ],
        submit: 'Вставить',
      });
      if (!v) return;
      const rows = clamp(parseInt(v.rows, 10) || 3, 1, 20);
      const cols = clamp(parseInt(v.cols, 10) || 3, 1, 10);
      insertHtml(tableHtml(rows, cols));
    }

    function addRow(cell) {
      const tr = cell.parentElement;
      const row = document.createElement('tr');
      row.innerHTML = '<td><br></td>'.repeat(tr.children.length);
      tr.after(row);
    }

    function addCol(cell) {
      const idx = [...cell.parentElement.children].indexOf(cell);
      for (const tr of cell.closest('table').rows) {
        const head = tr.parentElement.tagName === 'THEAD';
        const c = document.createElement(head ? 'th' : 'td');
        c.innerHTML = head ? 'Столбец' : '<br>';
        if (tr.children[idx]) tr.children[idx].after(c); else tr.append(c);
      }
    }

    function delRow(cell) {
      const table = cell.closest('table');
      if (table.rows.length <= 1) table.remove();
      else cell.parentElement.remove();
    }

    function delCol(cell) {
      const table = cell.closest('table');
      const idx = [...cell.parentElement.children].indexOf(cell);
      if (cell.parentElement.children.length <= 1) { table.remove(); return; }
      for (const tr of table.rows) if (tr.children[idx]) tr.children[idx].remove();
    }

    async function tableAction() {
      const cell = currentCell();
      if (!cell) return newTable();
      const what = await chooseDialog({
        title: 'Таблица',
        description: 'Курсор стоит внутри таблицы.',
        options: [
          { key: 'row', label: 'Добавить строку ниже', icon: 'plus' },
          { key: 'col', label: 'Добавить столбец справа', icon: 'plus' },
          { key: 'delrow', label: 'Удалить строку', icon: 'trash' },
          { key: 'delcol', label: 'Удалить столбец', icon: 'trash' },
          { key: 'new', label: 'Вставить другую таблицу', icon: 'table' },
        ],
      });
      if (!what) return;
      if (what === 'new') return newTable();
      ({ row: addRow, col: addCol, delrow: delRow, delcol: delCol })[what](cell);
      onEdit();
    }

    /* --- картинка в тексте ----------------------------------------------- */

    const escAttr = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

    async function insertImage() {
      const files = await pickFiles('image/*', false);
      if (!files.length) return;
      try {
        const a = await DB.addAsset(node.id, files[0], 'inline');
        insertHtml(`<img data-asset="${a.id}" src="${blobUrl(a.blob)}" alt="${escAttr(a.name)}"><p><br></p>`);
        toast('Картинка вставлена в текст');
      } catch (err) {
        toast('Не удалось вставить картинку: ' + err.message, 'err');
      }
    }

    /* --- панель приёмов над текстом -------------------------------------- */

    function tool(content, titleText, onclick) {
      const b = el('button', { class: 'btn btn-ghost doc-tool', title: titleText, onclick }, [content]);
      b.addEventListener('mousedown', (e) => e.preventDefault());   // не отбираем курсор у текста
      return b;
    }

    const docTools = el('div', { class: 'doc-tools' }, [
      tool(el('b', { text: 'Ж' }), 'Полужирный', () => exec('bold')),
      tool(el('i', { text: 'К' }), 'Курсив', () => exec('italic')),
      tool(el('span', { class: 'tool-h', text: 'H' }), 'Подзаголовок', () => exec('formatBlock', 'h3')),
      tool(icon('list', 18), 'Список', () => exec('insertUnorderedList')),
      el('span', { class: 'doc-tools-sep' }),
      tool(icon('table', 18), 'Таблица', tableAction),
      tool(icon('image', 18), 'Картинка в текст', insertImage),
    ]);

    function refreshMeta() {
      const words = (node.text || '').trim() ? (node.text.trim().match(/\S+/g) || []).length : 0;
      const media = assets.filter((a) => a.kind !== 'cover' && a.kind !== 'inline').length;
      meta.textContent = `${space ? space.name : 'пространство'} · ${words} ${plural(words, 'слово', 'слова', 'слов')} · ${media} ${plural(media, 'файл', 'файла', 'файлов')}`;
    }

    const doc = el('div', { class: 'doc' }, [
      el('div', { class: 'doc-inner' }, [title, meta, docTools, editor]),
    ]);
    const side = el('aside', { class: 'side' });

    /* --- размер картинок меняется перетягиванием за углы ------------------ */

    const CORNERS = { nw: -1, sw: -1, ne: 1, se: 1 };   // знак: как угол меняет ширину
    const imgFrame = el('div', { class: 'img-frame', hidden: true },
      Object.keys(CORNERS).map((c) => el('span', { class: 'ih ih-' + c, dataset: { corner: c } })));
    doc.append(imgFrame);

    let activeImg = null;

    function hideFrame() { activeImg = null; imgFrame.hidden = true; }

    function placeFrame() {
      if (!activeImg || !editor.contains(activeImg)) return hideFrame();
      const dr = doc.getBoundingClientRect();
      const ir = activeImg.getBoundingClientRect();
      imgFrame.hidden = false;
      imgFrame.style.left = (ir.left - dr.left + doc.scrollLeft) + 'px';
      imgFrame.style.top = (ir.top - dr.top + doc.scrollTop) + 'px';
      imgFrame.style.width = ir.width + 'px';
      imgFrame.style.height = ir.height + 'px';
    }

    editor.addEventListener('click', (e) => {
      const img = e.target.tagName === 'IMG' ? e.target : null;
      if (img) { activeImg = img; placeFrame(); } else hideFrame();
    });
    editor.addEventListener('input', () => { if (activeImg) placeFrame(); });
    doc.addEventListener('scroll', () => { if (activeImg) placeFrame(); }, { passive: true });
    const onWinResize = () => { if (activeImg) placeFrame(); };
    window.addEventListener('resize', onWinResize);

    for (const h of imgFrame.querySelectorAll('.ih')) {
      h.addEventListener('pointerdown', (e) => {
        if (!activeImg) return;
        e.preventDefault();
        e.stopPropagation();
        const grow = CORNERS[h.dataset.corner];
        const startX = e.clientX;
        const startW = activeImg.getBoundingClientRect().width;
        const maxW = editor.clientWidth;
        const img = activeImg;
        h.setPointerCapture(e.pointerId);

        const move = (ev) => {
          const w = clamp(Math.round(startW + (ev.clientX - startX) * grow), 48, maxW);
          img.setAttribute('width', w);
          placeFrame();
        };
        const up = (ev) => {
          try { h.releasePointerCapture(ev.pointerId); } catch (_) {}
          h.removeEventListener('pointermove', move);
          h.removeEventListener('pointerup', up);
          h.removeEventListener('pointercancel', up);
          placeFrame();
          onEdit();
        };
        h.addEventListener('pointermove', move);
        h.addEventListener('pointerup', up);
        h.addEventListener('pointercancel', up);
      });
    }

    /* --- свиток плана: тот же узел, что и на прошлом объекте -------------- */

    const scratch = scratchPanel(space || { id: node.spaceId, name: '', scratch: '' });
    // при переносе узла браузер сбрасывает прокрутку — запоминаем её
    const keep = {
      scroll: scratch.area.scrollTop,
      start: scratch.area.selectionStart,
      end: scratch.area.selectionEnd,
    };

    const body = el('div', { class: 'detail-body' }, [scratch.root, doc, side]);
    scratchHost = body;

    root.replaceChildren(
      topbar({
        title: node.name,
        sub: space ? space.name : '',
        back: { title: 'Назад в пространство', onclick: () => go('#/s/' + node.spaceId) },
        actions: [saveStatus, el('button', { class: 'btn btn-ghost btn-icon', title: 'В меню', onclick: () => go('#/') }, [icon('home')])],
      }),
      el('div', { class: 'detail-screen' }, [body]),
    );

    setScratchOpen(scratchWasOpen(node.spaceId));
    scratch.area.scrollTop = keep.scroll;
    try { scratch.area.setSelectionRange(keep.start, keep.end); } catch (_) {}
    updateEmpty();
    refreshMeta();

    /* --- боковая панель -------------------------------------------------- */

    // все панели справа открываются закрытыми; раскрытые пользователем
    // остаются такими, пока он не уйдёт с объекта
    const openState = { dice: false, calc: false, media: false, audio: false, notes: false, links: false };

    // калькулятор и кубики собираем один раз: при перерисовке панели они
    // переезжают целиком и сохраняют введённое выражение и выпавшие значения
    const calcWidget = CALC.widget();
    const diceWidget = CALC.diceWidget();

    function panel(key, iconName, name, count, content, action) {
      const p = el('details', { class: 'panel', open: openState[key] });
      p.addEventListener('toggle', () => { openState[key] = p.open; });
      p.append(
        el('summary', {}, [
          el('span', { class: 'chev' }, [icon('chev', 16)]),
          icon(iconName, 18),
          el('span', { text: name }),
          count === null ? null : el('span', { class: 'count', text: String(count) }),
        ].filter(Boolean)),
        el('div', { class: 'panel-body' }, [content, action].filter(Boolean)),
      );
      return p;
    }

    function renderSide() {
      const media = assets.filter((a) => a.kind === 'image' || a.kind === 'video');
      const tracks = assets.filter((a) => a.kind === 'audio');
      const notes = node.notes || [];
      const myLinks = links.filter((l) => l.a === node.id || l.b === node.id);

      /* галерея */
      const gallery = media.length
        ? el('div', { class: 'gallery' }, media.map((a) => {
            const url = blobUrl(a.blob);
            const thumb = a.kind === 'video'
              ? el('video', { src: url, muted: true, preload: 'metadata' })
              : el('img', { src: url, alt: a.name, loading: 'lazy' });
            return el('button', {
              class: 'gallery-item', title: `${a.name} · ${fmtSize(a.size)}`,
              onclick: () => lightbox(url, a.mime, a.name),
              oncontextmenu: async (e) => {
                e.preventDefault();
                const ok = await confirmDialog({ title: 'Удалить файл?', description: a.name });
                if (!ok) return;
                await DB.deleteAsset(a.id);
                assets = assets.filter((x) => x.id !== a.id);
                renderSide(); refreshMeta();
              },
            }, [thumb, a.kind === 'video' ? el('span', { class: 'vid-badge' }, [icon('play', 14)]) : null]);
          }))
        : el('div', { class: 'panel-empty', text: 'Ни одного изображения. Правый клик по миниатюре удаляет файл.' });

      /* музыка */
      const music = tracks.length
        ? el('div', { style: { display: 'flex', flexDirection: 'column', gap: '4px' } }, tracks.map((a) => {
            const url = blobUrl(a.blob);
            return el('div', { class: 'track' }, [
              el('div', { class: 'track-head' }, [
                el('span', { class: 'track-name', text: a.name, title: `${a.name} · ${fmtSize(a.size)}` }),
                el('button', { class: 'btn btn-ghost btn-icon', title: 'Слушать поверх всех экранов', onclick: () => playTrack(a) }, [icon('play', 16)]),
                el('button', {
                  class: 'btn btn-ghost btn-icon', title: 'Удалить',
                  onclick: async () => {
                    const ok = await confirmDialog({ title: 'Удалить запись?', description: a.name });
                    if (!ok) return;
                    await DB.deleteAsset(a.id);
                    assets = assets.filter((x) => x.id !== a.id);
                    renderSide(); refreshMeta();
                  },
                }, [icon('trash', 16)]),
              ]),
              el('audio', { src: url, controls: true, preload: 'none' }),
            ]);
          }))
        : el('div', { class: 'panel-empty', text: 'Тишина. Загрузи эмбиент или боевую тему.' });

      /* пометки */
      const notesBody = notes.length
        ? el('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px' } }, notes.slice().reverse().map((n) =>
            el('div', { class: 'note' }, [
              el('p', { text: n.text }),
              el('div', { class: 'note-foot' }, [
                el('span', { class: 'note-date', text: fmtDate(n.createdAt) }),
                el('span', { style: { flex: '1' } }),
                el('button', {
                  class: 'btn btn-ghost btn-icon', title: 'Удалить пометку',
                  onclick: async () => {
                    node.notes = (node.notes || []).filter((x) => x.id !== n.id);
                    await DB.updateNode(node.id, { notes: node.notes });
                    renderSide();
                  },
                }, [icon('trash', 16)]),
              ]),
            ])))
        : el('div', { class: 'panel-empty', text: 'Короткие напоминания себе: «у трактирщика долг перед гильдией».' });

      /* связи */
      const byId = new Map(siblings.map((n) => [n.id, n]));
      const linksBody = myLinks.length
        ? el('div', { style: { display: 'flex', flexDirection: 'column', gap: '4px' } }, myLinks.map((l) => {
            const other = byId.get(l.a === node.id ? l.b : l.a);
            if (!other) return null;
            return el('button', { class: 'link-row', onclick: () => go('#/n/' + other.id) }, [
              icon('chain', 18),
              el('span', { class: 'lr-name', text: other.name }),
              el('span', { class: 'chev' }, [icon('chev', 16)]),
            ]);
          }).filter(Boolean))
        : el('div', { class: 'panel-empty', text: 'Связи протягиваются в пространстве — инструментом «Связь».' });

      side.replaceChildren(
        panel('dice', 'd20', 'Кубики', null, diceWidget),
        panel('calc', 'calc', 'Калькулятор', null, calcWidget),
        panel('media', 'image', 'Изображения и видео', media.length, gallery,
          el('button', { class: 'btn', onclick: () => upload('image/*,video/*', 'media') }, [icon('plus', 18), 'Загрузить'])),
        panel('audio', 'music', 'Музыка', tracks.length, music,
          el('button', { class: 'btn', onclick: () => upload('audio/*', 'audio') }, [icon('plus', 18), 'Загрузить'])),
        panel('notes', 'note', 'Пометки', notes.length, notesBody,
          el('button', { class: 'btn', onclick: addNote }, [icon('plus', 18), 'Добавить пометку'])),
        panel('links', 'chain', 'Связанные директории', myLinks.length, linksBody,
          el('button', { class: 'btn', onclick: () => go('#/s/' + node.spaceId) }, [icon('link', 18), 'В пространство'])),
      );
    }

    async function upload(accept, group) {
      const files = await pickFiles(accept, true);
      if (!files.length) return;
      for (const f of files) {
        const kind = group === 'audio' ? 'audio' : (f.type.startsWith('video') ? 'video' : 'image');
        try {
          const a = await DB.addAsset(node.id, f, kind);
          assets.push(a);
        } catch (err) {
          toast(`Не удалось сохранить «${f.name}»: ${err.message}`, 'err');
        }
      }
      if (!node.coverId) {
        const firstImage = assets.find((a) => a.kind === 'image');
        if (firstImage) { node.coverId = firstImage.id; await DB.updateNode(node.id, { coverId: firstImage.id }); }
      }
      await DB.touchSpace(node.spaceId);
      renderSide(); refreshMeta();
      toast(`Загружено: ${files.length} ${plural(files.length, 'файл', 'файла', 'файлов')}`);
    }

    async function addNote() {
      const v = await formDialog({
        title: 'Новая пометка',
        fields: [{ key: 'text', label: 'Текст', type: 'textarea', placeholder: 'Что нельзя забыть' }],
        submit: 'Добавить',
      });
      if (!v) return;
      node.notes = (node.notes || []).concat({ id: DB.uid(), text: v.text, createdAt: Date.now() });
      await DB.updateNode(node.id, { notes: node.notes });
      renderSide();
      toast('Пометка добавлена');
    }

    renderSide();
    setTeardown(() => {
      document.removeEventListener('selectionchange', rememberRange);
      window.removeEventListener('resize', onWinResize);
    });
  }

  return { render };
})();
