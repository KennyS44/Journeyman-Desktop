/* ==========================================================================
   screens/space.js — экран #/s/<id> : холст пространства.
   Карточки объектов, нити связей, панорама и масштаб.
   ========================================================================== */

const SPACE = (() => {
  const { el, icon, toast, formDialog, confirmDialog, pickFiles, blobUrl, debounce } = UI;
  const { root, go, route, topbar, clamp, setTeardown } = APP;

  const NODE_W = 176;          // ширина карточки объекта, см. .node в CSS
  const MIN_SCALE = 0.35;
  const MAX_SCALE = 2.5;

  /* --- положение камеры между заходами ---------------------------------- */

  function loadCam(spaceId) {
    try {
      const raw = localStorage.getItem('jm.cam.' + spaceId);
      if (raw) { const c = JSON.parse(raw); return { x: c.x, y: c.y, scale: clamp(c.scale, MIN_SCALE, MAX_SCALE), touched: true }; }
    } catch (_) {}
    return { x: 0, y: 0, scale: 1, touched: false };
  }
  const saveCam = debounce((spaceId, cam) => {
    try { localStorage.setItem('jm.cam.' + spaceId, JSON.stringify({ x: cam.x, y: cam.y, scale: cam.scale })); } catch (_) {}
  }, 300);

  async function render(spaceId) {
    const space = await DB.getSpace(spaceId);
    if (!space) { toast('Пространство не найдено', 'err'); return MENU.render(); }
    document.title = space.name + ' — Journeyman';

    let nodes = await DB.listNodes(spaceId);
    let links = await DB.listLinks(spaceId);

    const cam = loadCam(spaceId);
    let linkMode = false;
    let linkSource = null;
    let selectedLink = null;

    const world = el('div', { class: 'canvas-world' });
    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('class', 'wires');
    world.append(svg);

    const viewport = el('div', { class: 'canvas-viewport' }, [world]);
    const banner = el('div', { class: 'link-banner', hidden: true });
    const zoomLabel = el('span', { class: 'zoom-label' });

    const btnAdd = el('button', { class: 'btn btn-primary', onclick: () => addNode() },
      [icon('plus'), el('span', { class: 'lbl', text: 'Объект' })]);
    const btnLink = el('button', { class: 'btn', title: 'Инструмент связи', onclick: () => setLinkMode(!linkMode) },
      [icon('link'), el('span', { class: 'lbl', text: 'Связь' })]);

    const toolbar = el('div', { class: 'toolbar' }, [
      btnAdd,
      btnLink,
      el('span', { class: 'sep' }),
      el('button', { class: 'btn btn-icon', title: 'Отдалить', onclick: () => zoomBy(1 / 1.2) }, [icon('minus')]),
      zoomLabel,
      el('button', { class: 'btn btn-icon', title: 'Приблизить', onclick: () => zoomBy(1.2) }, [icon('plus')]),
      el('button', { class: 'btn btn-icon', title: 'Показать всё', onclick: fitAll }, [icon('center')]),
    ]);

    const hint = el('div', { class: 'canvas-hint' }, [
      el('div', { class: 'empty' }, [
        el('h3', { text: 'Чистый пергамент' }),
        el('p', { text: 'Добавь первый ключевой объект — персонажа, локацию, артефакт. Карточки свободно перетаскиваются по холсту, а инструмент «Связь» протянет между ними нити.' }),
      ]),
    ]);

    viewport.append(banner, toolbar, hint);

    root.replaceChildren(
      topbar({
        title: space.name,
        sub: space.description || 'пространство',
        back: { title: 'К списку пространств', onclick: () => go('#/') },
        actions: [
          el('button', { class: 'btn btn-ghost btn-icon', title: 'Переименовать пространство', onclick: renameSpace }, [icon('pencil')]),
          el('button', { class: 'btn btn-ghost btn-icon', title: 'В меню', onclick: () => go('#/') }, [icon('home')]),
        ],
      }),
      el('div', { class: 'space-screen' }, [viewport]),
    );

    /* --- отрисовка --------------------------------------------------- */

    const nodeEls = new Map();
    let lastDragEnd = 0;          // чтобы клик сразу после перетаскивания не открывал карточку

    function applyCam() {
      world.style.transform = `translate(${cam.x}px, ${cam.y}px) scale(${cam.scale})`;
      zoomLabel.textContent = Math.round(cam.scale * 100) + '%';
      saveCam(spaceId, cam);
    }

    function nodeCenter(n) {
      const box = nodeEls.get(n.id);
      const h = box ? box.offsetHeight : 150;
      return { x: n.x + NODE_W / 2, y: n.y + h / 2 };
    }

    function drawWires() {
      const byId = new Map(nodes.map((n) => [n.id, n]));
      svg.replaceChildren();
      for (const l of links) {
        const a = byId.get(l.a), b = byId.get(l.b);
        if (!a || !b) continue;
        const p1 = nodeCenter(a), p2 = nodeCenter(b);
        const g = document.createElementNS(svgNS, 'g');
        g.setAttribute('class', 'wire-group' + (selectedLink === l.id ? ' selected' : ''));

        const d = `M ${p1.x} ${p1.y} L ${p2.x} ${p2.y}`;
        const hit = document.createElementNS(svgNS, 'path');
        hit.setAttribute('class', 'wire-hit');
        hit.setAttribute('d', d);
        const line = document.createElementNS(svgNS, 'path');
        line.setAttribute('class', 'wire');
        line.setAttribute('d', d);

        const dot = document.createElementNS(svgNS, 'circle');
        dot.setAttribute('class', 'wire-node');
        dot.setAttribute('cx', (p1.x + p2.x) / 2);
        dot.setAttribute('cy', (p1.y + p2.y) / 2);
        dot.setAttribute('r', 4);

        g.append(hit, line, dot);
        g.addEventListener('click', async (e) => {
          e.stopPropagation();
          selectedLink = l.id;
          drawWires();
          const ok = await confirmDialog({
            title: 'Разорвать связь?',
            description: `«${a.name}» — «${b.name}»`,
            confirm: 'Разорвать',
          });
          selectedLink = null;
          if (ok) {
            await DB.deleteLink(l.id);
            links = links.filter((x) => x.id !== l.id);
            toast('Связь разорвана');
          }
          drawWires();
        });
        svg.append(g);
      }
    }

    async function drawNodes() {
      for (const box of nodeEls.values()) box.remove();
      nodeEls.clear();
      for (const n of nodes) world.append(await nodeCard(n));
      hint.hidden = nodes.length > 0;
      drawWires();
    }

    async function nodeCard(n) {
      const box = el('div', {
        class: 'node', title: 'Перетащи, чтобы переместить',
        style: { left: n.x + 'px', top: n.y + 'px' },
      });
      nodeEls.set(n.id, box);

      let thumb;
      if (n.coverId) {
        const asset = await DB.getAsset(n.coverId);
        thumb = asset
          ? el('img', { class: 'node-thumb', src: blobUrl(asset.blob), alt: '' })
          : el('div', { class: 'node-thumb-fallback' }, [icon('image', 32)]);
      } else {
        thumb = el('div', { class: 'node-thumb-fallback' }, [icon('scroll', 32)]);
      }

      const open = () => {
        if (performance.now() - lastDragEnd < 300) return;
        go('#/n/' + n.id);
      };

      box.append(
        thumb,
        // в режиме связи выбор делает обработчик pointerdown — здесь только открытие
        el('button', { class: 'node-name', text: n.name, onclick: (e) => { e.stopPropagation(); if (!linkMode) open(); } }),
        el('span', { class: 'node-open-hint', text: linkMode ? 'нажми, чтобы связать' : 'открыть' }),
        el('div', { class: 'node-tools' }, [
          el('button', { title: 'Изображение объекта', onclick: async (e) => { e.stopPropagation(); await setCover(n); } }, [icon('image', 16)]),
          el('button', { title: 'Переименовать', onclick: async (e) => { e.stopPropagation(); await renameNode(n); } }, [icon('pencil', 16)]),
          el('button', { title: 'Удалить объект', onclick: async (e) => { e.stopPropagation(); await removeNode(n); } }, [icon('trash', 16)]),
        ]),
      );

      box.addEventListener('dblclick', (e) => { e.stopPropagation(); if (!linkMode) open(); });
      makeDraggable(box, n);
      return box;
    }

    /* --- перетаскивание объекта --------------------------------------- */

    function makeDraggable(box, n) {
      let start = null;
      box.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        if (e.target.closest('.node-tools')) return;
        if (linkMode) { e.stopPropagation(); pickForLink(n); return; }
        e.stopPropagation();
        // указатель захватываем только когда перетаскивание действительно начнётся,
        // иначе браузер перенаправит click с кнопки внутри карточки на саму карточку
        start = { px: e.clientX, py: e.clientY, nx: n.x, ny: n.y, moved: false };
      });
      box.addEventListener('pointermove', (e) => {
        if (!start) return;
        const dx = (e.clientX - start.px) / cam.scale;
        const dy = (e.clientY - start.py) / cam.scale;
        if (!start.moved && Math.hypot(dx, dy) * cam.scale < 4) return;
        if (!start.moved) {
          start.moved = true;
          box.classList.add('dragging');
          try { box.setPointerCapture(e.pointerId); } catch (_) {}
        }
        n.x = Math.round(start.nx + dx);
        n.y = Math.round(start.ny + dy);
        box.style.left = n.x + 'px';
        box.style.top = n.y + 'px';
        drawWires();
      });
      const end = async (e) => {
        if (!start) return;
        const moved = start.moved;
        start = null;
        box.classList.remove('dragging');
        try { box.releasePointerCapture(e.pointerId); } catch (_) {}
        if (!moved) return;
        lastDragEnd = performance.now();
        await DB.updateNode(n.id, { x: n.x, y: n.y });
      };
      box.addEventListener('pointerup', end);
      box.addEventListener('pointercancel', end);
    }

    /* --- инструмент связи --------------------------------------------- */

    function setLinkMode(on) {
      linkMode = on;
      linkSource = null;
      btnLink.classList.toggle('is-active', on);
      viewport.classList.toggle('mode-link', on);
      for (const box of nodeEls.values()) {
        box.classList.remove('link-source');
        const hintEl = box.querySelector('.node-open-hint');
        if (hintEl) hintEl.textContent = on ? 'нажми, чтобы связать' : 'открыть';
      }
      banner.hidden = !on;
      banner.textContent = 'Режим связи: выбери первый объект, затем второй. Esc — выйти.';
    }

    async function pickForLink(n) {
      if (!linkSource) {
        linkSource = n.id;
        nodeEls.get(n.id)?.classList.add('link-source');
        banner.textContent = `Первый объект: «${n.name}». Теперь выбери второй.`;
        return;
      }
      if (linkSource === n.id) {
        nodeEls.get(n.id)?.classList.remove('link-source');
        linkSource = null;
        banner.textContent = 'Режим связи: выбери первый объект, затем второй. Esc — выйти.';
        return;
      }
      const from = nodes.find((x) => x.id === linkSource);
      const link = await DB.createLink(spaceId, linkSource, n.id, '');
      nodeEls.get(linkSource)?.classList.remove('link-source');
      linkSource = null;
      if (link && !links.some((l) => l.id === link.id)) {
        links.push(link);
        toast(`«${from ? from.name : '…'}» связан с «${n.name}»`);
      } else {
        toast('Эти объекты уже связаны');
      }
      banner.textContent = 'Связь создана. Выбери следующую пару или нажми Esc.';
      drawWires();
    }

    const onKey = (e) => {
      if (e.key === 'Escape' && linkMode) { setLinkMode(false); }
    };
    document.addEventListener('keydown', onKey);

    /* --- панорама и масштаб -------------------------------------------- */

    const pointers = new Map();
    let panStart = null;
    let pinchStart = null;

    viewport.addEventListener('pointerdown', (e) => {
      if (e.target.closest('.toolbar') || e.target.closest('.node')) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 1) {
        panStart = { px: e.clientX, py: e.clientY, cx: cam.x, cy: cam.y };
        viewport.classList.add('is-panning');
        viewport.setPointerCapture(e.pointerId);
      } else if (pointers.size === 2) {
        panStart = null;
        const [p1, p2] = [...pointers.values()];
        pinchStart = { dist: Math.hypot(p1.x - p2.x, p1.y - p2.y), scale: cam.scale,
                       mid: { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 }, cx: cam.x, cy: cam.y };
      }
    });

    viewport.addEventListener('pointermove', (e) => {
      if (!pointers.has(e.pointerId)) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pinchStart && pointers.size === 2) {
        const [p1, p2] = [...pointers.values()];
        const dist = Math.hypot(p1.x - p2.x, p1.y - p2.y);
        const next = clamp(pinchStart.scale * (dist / pinchStart.dist), MIN_SCALE, MAX_SCALE);
        const r = viewport.getBoundingClientRect();
        const mx = pinchStart.mid.x - r.left, my = pinchStart.mid.y - r.top;
        const k = next / pinchStart.scale;
        cam.x = mx - (mx - pinchStart.cx) * k;
        cam.y = my - (my - pinchStart.cy) * k;
        cam.scale = next;
        applyCam();
      } else if (panStart) {
        cam.x = panStart.cx + (e.clientX - panStart.px);
        cam.y = panStart.cy + (e.clientY - panStart.py);
        applyCam();
      }
    });

    const endPan = (e) => {
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinchStart = null;
      if (pointers.size === 0) { panStart = null; viewport.classList.remove('is-panning'); }
    };
    viewport.addEventListener('pointerup', endPan);
    viewport.addEventListener('pointercancel', endPan);

    viewport.addEventListener('wheel', (e) => {
      e.preventDefault();
      const r = viewport.getBoundingClientRect();
      zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * 0.0015));
    }, { passive: false });

    function zoomAt(mx, my, k) {
      const next = clamp(cam.scale * k, MIN_SCALE, MAX_SCALE);
      const ratio = next / cam.scale;
      cam.x = mx - (mx - cam.x) * ratio;
      cam.y = my - (my - cam.y) * ratio;
      cam.scale = next;
      applyCam();
    }

    function zoomBy(k) {
      const r = viewport.getBoundingClientRect();
      zoomAt(r.width / 2, r.height / 2, k);
    }

    function fitAll() {
      if (!nodes.length) { cam.x = 0; cam.y = 0; cam.scale = 1; return applyCam(); }
      const r = viewport.getBoundingClientRect();
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const n of nodes) {
        const h = nodeEls.get(n.id)?.offsetHeight || 150;
        minX = Math.min(minX, n.x); minY = Math.min(minY, n.y);
        maxX = Math.max(maxX, n.x + NODE_W); maxY = Math.max(maxY, n.y + h);
      }
      const pad = 48;
      const padBottom = 112;              // место для панели инструментов
      const w = r.width - pad * 2;
      const h = r.height - pad - padBottom;
      const scale = clamp(Math.min(w / (maxX - minX), h / (maxY - minY), 1.2), MIN_SCALE, MAX_SCALE);
      cam.scale = scale;
      cam.x = pad + (w - (maxX - minX) * scale) / 2 - minX * scale;
      cam.y = pad + (h - (maxY - minY) * scale) / 2 - minY * scale;
      applyCam();
    }

    function viewCenterWorld() {
      const r = viewport.getBoundingClientRect();
      return { x: (r.width / 2 - cam.x) / cam.scale, y: (r.height / 2 - cam.y) / cam.scale };
    }

    /** Ближайшее к центру экрана место, где карточка ни на кого не наложится. */
    function freeSpot() {
      const GAP = 32;
      const H = 200;                                   // запас по высоте карточки
      const c = viewCenterWorld();
      const base = { x: Math.round(c.x - NODE_W / 2), y: Math.round(c.y - H / 2) };
      const boxes = nodes.map((n) => ({ x: n.x, y: n.y, h: nodeEls.get(n.id)?.offsetHeight || H }));
      const free = (p) => !boxes.some((b) =>
        p.x < b.x + NODE_W + GAP && p.x + NODE_W + GAP > b.x &&
        p.y < b.y + b.h + GAP && p.y + H + GAP > b.y);
      if (free(base)) return base;
      // расходящаяся спираль по сетке карточек
      const stepX = NODE_W + GAP, stepY = H + GAP;
      for (let ring = 1; ring <= 12; ring++) {
        for (let dx = -ring; dx <= ring; dx++) {
          for (let dy = -ring; dy <= ring; dy++) {
            if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
            const p = { x: base.x + dx * stepX, y: base.y + dy * stepY };
            if (free(p)) return p;
          }
        }
      }
      return { x: base.x + nodes.length * 24, y: base.y + nodes.length * 24 };
    }

    /* --- действия над объектами ---------------------------------------- */

    async function addNode() {
      const v = await formDialog({
        title: 'Новый ключевой объект',
        description: 'Персонаж, локация, артефакт, событие — всё, к чему захочется вернуться.',
        fields: [{ key: 'name', label: 'Наименование', placeholder: 'Таверна «Спящий великан»' }],
        submit: 'Добавить',
      });
      if (!v) return;
      const spot = freeSpot();
      const n = await DB.createNode(spaceId, v.name, spot.x, spot.y);
      nodes.push(n);
      await drawNodes();
      toast('Объект добавлен');
    }

    async function renameNode(n) {
      const v = await formDialog({
        title: 'Переименовать объект',
        fields: [{ key: 'name', label: 'Наименование', value: n.name }],
      });
      if (!v) return;
      n.name = v.name;
      await DB.updateNode(n.id, { name: v.name });
      await drawNodes();
    }

    async function removeNode(n) {
      const ok = await confirmDialog({
        title: `Удалить «${n.name}»?`,
        description: 'Текст, изображения, музыка и пометки объекта будут удалены вместе с ним.',
      });
      if (!ok) return;
      await DB.deleteNode(n.id);
      nodes = nodes.filter((x) => x.id !== n.id);
      links = links.filter((l) => l.a !== n.id && l.b !== n.id);
      await drawNodes();
      toast('Объект удалён');
    }

    async function setCover(n) {
      const files = await pickFiles('image/*', false);
      if (!files.length) return;
      if (n.coverId) await DB.deleteAsset(n.coverId);
      const asset = await DB.addAsset(n.id, files[0], 'cover');
      n.coverId = asset.id;
      await DB.updateNode(n.id, { coverId: asset.id });
      await drawNodes();
      toast('Изображение обновлено');
    }

    async function renameSpace() {
      const v = await formDialog({
        title: 'Пространство',
        fields: [
          { key: 'name', label: 'Название', value: space.name },
          { key: 'description', label: 'Описание', type: 'textarea', value: space.description },
        ],
      });
      if (!v) return;
      await DB.updateSpace(space.id, { name: v.name, description: v.description });
      route();
    }

    /* --- запуск экрана -------------------------------------------------- */

    await drawNodes();
    applyCam();
    if (!cam.touched && nodes.length) { fitAll(); }

    setTeardown(() => { document.removeEventListener('keydown', onKey); });
  }

  return { render };
})();
