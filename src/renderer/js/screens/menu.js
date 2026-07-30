/* ==========================================================================
   screens/menu.js — экран #/ : список пространств.
   ========================================================================== */

const MENU = (() => {
  const { el, icon, toast, formDialog, confirmDialog, fmtDate, plural } = UI;
  const { root, go, route, topbar } = APP;

  async function render() {
    document.title = 'Journeyman — кодекс мастера';
    const spaces = await DB.listSpaces();
    const counts = {};
    for (const s of spaces) counts[s.id] = (await DB.listNodes(s.id)).length;

    const grid = el('div', { class: 'space-grid' });

    grid.append(el('button', { class: 'space-card new', onclick: newSpace }, [
      el('div', { class: 'plus', text: '+' }),
      el('h3', { text: 'Новое пространство' }),
      el('div', { class: 'space-desc', text: 'Кампания, город, подземелье — что угодно' }),
    ]));

    for (const s of spaces) {
      const n = counts[s.id];
      const card = el('div', {
        class: 'space-card', role: 'button', tabindex: '0',
        onclick: () => go('#/s/' + s.id),
        onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go('#/s/' + s.id); } },
      }, [
        el('h3', { text: s.name }),
        s.description ? el('div', { class: 'space-desc', text: s.description }) : null,
        el('div', { class: 'space-meta', text:
          `${n} ${plural(n, 'объект', 'объекта', 'объектов')} · изменено ${fmtDate(s.updatedAt)}` }),
        el('button', {
          class: 'card-del', title: 'Удалить пространство',
          onclick: async (e) => {
            e.stopPropagation();
            const ok = await confirmDialog({
              title: `Удалить «${s.name}»?`,
              description: 'Вместе с пространством исчезнут все его объекты, тексты, изображения и музыка. Отменить будет нельзя.',
            });
            if (!ok) return;
            await DB.deleteSpace(s.id);
            toast('Пространство удалено');
            route();
          },
        }, [icon('trash', 18)]),
      ]);
      grid.append(card);
    }

    root.replaceChildren(
      topbar({
        title: 'Journeyman',
        sub: 'кодекс мастера',
        actions: [el('button', { class: 'btn btn-primary', onclick: newSpace }, [icon('plus'), el('span', { text: 'Пространство' })])],
      }),
      el('main', { class: 'menu-wrap' }, [
        el('section', { class: 'hero' }, [
          el('div', { class: 'hero-mark' }, [icon('d20', 48)]),
          el('h1', { text: 'Твои миры под рукой' }),
          el('p', { text: 'Собирай пространства для кампаний: расставляй ключевые объекты, связывай их нитями и храни внутри тексты, образы и музыку.' }),
        ]),
        el('div', { class: 'rune-rule' }, [icon('d20', 16)]),
        spaces.length === 0
          ? el('div', { class: 'empty', style: { marginTop: '24px' } }, [
              el('h3', { text: 'Пока пусто' }),
              el('p', { text: 'Создай первое пространство — например, «Побережье Мечей» или «Кампания: Проклятие Страда».' }),
            ])
          : null,
        grid,
      ]),
    );
  }

  async function newSpace() {
    const v = await formDialog({
      title: 'Новое пространство',
      description: 'Свободная зона, куда вы будете добавлять ключевые объекты и связывать их между собой.',
      fields: [
        { key: 'name', label: 'Название', placeholder: 'Побережье Мечей' },
        { key: 'description', label: 'Описание', type: 'textarea', placeholder: 'Пара слов о том, что здесь хранится' },
      ],
      submit: 'Создать',
    });
    if (!v) return;
    const s = await DB.createSpace(v.name, v.description);
    go('#/s/' + s.id);
  }

  return { render };
})();
