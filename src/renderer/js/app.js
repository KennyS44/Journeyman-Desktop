/* ==========================================================================
   app.js — оболочка приложения: маршруты, общая шапка, мини-плеер.
   Сами экраны лежат отдельно: js/screens/menu.js, space.js, node.js —
   каждый из них берёт отсюда go/topbar/root и отдаёт свой render().
   Маршруты:  #/          меню пространств
              #/s/<id>    холст пространства
              #/n/<id>    внутренняя директория ключевого объекта
   ========================================================================== */

const APP = (() => {
  const { el, icon, toast, releaseUrls, bindVolume } = UI;

  const root = document.getElementById('app');

  /* ======================================================================
     Маршрутизация
     ====================================================================== */

  let teardown = null;

  /** Экран сообщает, что снять при уходе с него (слушатели на document/window). */
  function setTeardown(fn) { teardown = fn; }

  function go(hash) {
    if (location.hash === hash) route();
    else location.hash = hash;
  }

  async function route() {
    if (teardown) { try { teardown(); } catch (_) {} teardown = null; }
    releaseUrls(keepUrls());
    const h = location.hash.replace(/^#/, '') || '/';
    const parts = h.split('/').filter(Boolean);
    try {
      if (parts[0] === 's' && parts[1]) return await SPACE.render(parts[1]);
      if (parts[0] === 'n' && parts[1]) return await NODE.render(parts[1]);
      return await MENU.render();
    } catch (err) {
      console.error(err);
      toast('Не удалось открыть раздел: ' + err.message, 'err');
      await MENU.render();
    }
  }

  window.addEventListener('hashchange', route);

  /* ======================================================================
     Мини-плеер (живёт поверх всех экранов)
     ====================================================================== */

  const player = { bar: null, audio: null, url: null };

  function playTrack(asset) {
    if (player.url) URL.revokeObjectURL(player.url);
    player.url = URL.createObjectURL(asset.blob);
    if (!player.bar) {
      player.audio = bindVolume(el('audio', { controls: true, autoplay: true }));
      player.bar = el('div', { class: 'player' }, [
        el('span', { class: 'pl-name' }),
        player.audio,
        el('button', { class: 'btn btn-ghost btn-icon', title: 'Закрыть плеер', onclick: stopTrack }, [icon('close', 18)]),
      ]);
      document.body.append(player.bar);
    }
    player.bar.querySelector('.pl-name').textContent = asset.name;
    player.audio.src = player.url;
    player.audio.play().catch(() => {});
  }

  function stopTrack() {
    if (player.audio) player.audio.pause();
    if (player.url) { URL.revokeObjectURL(player.url); player.url = null; }
    if (player.bar) { player.bar.remove(); player.bar = null; player.audio = null; }
  }

  const keepUrls = () => new Set();

  /* ======================================================================
     Общая шапка
     ====================================================================== */

  function topbar({ title, sub, back, actions = [] }) {
    return el('header', { class: 'topbar' }, [
      back ? el('button', { class: 'btn btn-ghost btn-icon', title: back.title, onclick: back.onclick }, [icon('back')]) : null,
      el('div', { style: { minWidth: '0' } }, [
        el('div', { class: 'topbar-title', text: title }),
        sub ? el('div', { class: 'topbar-sub', text: sub }) : null,
      ]),
      el('div', { class: 'topbar-spacer' }),
      el('div', { class: 'topbar-actions' }, actions),
    ]);
  }

  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

  /* ======================================================================
     Старт — когда все экраны уже загружены
     ====================================================================== */

  document.addEventListener('DOMContentLoaded', route);

  return { root, go, route, topbar, clamp, playTrack, setTeardown };
})();
