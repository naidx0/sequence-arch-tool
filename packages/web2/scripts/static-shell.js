/* THE STATIC SHELL'S PRE-PAINT SCRIPT, inlined into dist/index.html by
   prerender-shell.mjs right after #static-shell. Plain ES5, no imports.

   1. KEEP THE FRAME ONLY WHEN IT MATCHES what React will draw: the frame is
      the default chat-only layout, so a stored layout that differs (other tabs,
      a folded sidebar, the Agents panel open, a narrow window's switched
      layout, a Mac's title bar) removes it, and the splash stays as before.
      A dragged chat width is taken on only when a surface is open (React
      ignores v3.chatW while the chat is centred). Chat-only applies the same
      overview shift ChatOverview's layout effect writes (overviewPlace.ts).
   2. MAKE IT TYPEABLE: the splash goes, the composer field takes focus, and
      Enter or Send is remembered as a pending send for React to carry out
      (chat/staticHandoff.ts). */
(function () {
  var L = __LAYOUT__;
  var shell = document.getElementById('static-shell');
  if (!shell) return;
  function drop(why) {
    window.__sequenceStaticShellDropped = why;
    if (shell.parentNode) shell.parentNode.removeChild(shell);
  }
  function toBox(el) {
    if (!el) return null;
    var r = el.getBoundingClientRect();
    if (r.right - r.left <= 0) return null;
    return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
  }
  /* Keep in lockstep with packages/web2/src/overview/overviewPlace.ts placeOverview. */
  function placeOverview(container, column, chat, centred) {
    var gap = L.overviewGap;
    var panelMax = L.panelMaxW;
    var panelMin = L.panelMinW;
    var panelMaxH = L.panelMaxH;
    var pillW = L.pillW;
    var cardW = L.chatCardW;
    var chatMinW = L.chatMinW;
    var comfyW = L.chatComfyW;
    var need = panelMax + 2 * gap;
    if (!centred) return { chatShift: null };
    if (!container || !column || !chat) return { chatShift: null };
    var colW = column.right - column.left;
    var w0 = Math.min(cardW, colW);
    var left0 = column.left + (colW - w0) / 2;
    var margin0 = container.right - (left0 + w0);
    var chatShift = null;
    var fitsPanel = margin0 >= need;
    if (!fitsPanel) {
      var extra = need - margin0;
      var shift = Math.min(extra, Math.max(0, left0 - column.left - gap));
      var rest = extra - shift;
      var fromCard = Math.min(rest, Math.max(0, w0 - comfyW));
      rest -= fromCard;
      var fromPanel = Math.min(rest, panelMax - panelMin);
      rest -= fromPanel;
      if (w0 - (extra - shift) >= chatMinW) {
        chatShift = { left: left0 - shift - column.left, width: w0 - fromCard - rest };
        fitsPanel = true;
      }
    }
    if (fitsPanel) return { chatShift: chatShift };
    if (margin0 >= pillW + 2 * gap) return { chatShift: null };
    return { chatShift: null };
  }
  function applyChatOnlyShift() {
    var row = shell.querySelector('.s2-row');
    if (!row || row.getAttribute('data-stage') !== 'none') return;
    if (window.innerWidth < L.overviewMinW) return;
    var main = shell.querySelector('.s2-mainp');
    var col = shell.querySelector('.v3-chat-col');
    if (!col) return;
    var placed = placeOverview(toBox(row), toBox(main), toBox(col), true);
    if (!placed.chatShift) {
      col.style.removeProperty('--ov-left');
      col.style.removeProperty('--ov-w');
      col.removeAttribute('data-ov-shift');
      return;
    }
    col.style.setProperty('--ov-left', placed.chatShift.left + 'px');
    col.style.setProperty('--ov-w', placed.chatShift.width + 'px');
    col.setAttribute('data-ov-shift', 'true');
  }
  function scheduleChatOnlyShift() {
    applyChatOnlyShift();
    requestAnimationFrame(function () {
      applyChatOnlyShift();
    });
    if (document.readyState === 'complete') applyChatOnlyShift();
    else window.addEventListener('load', applyChatOnlyShift);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(applyChatOnlyShift);
  }
  try {
    if (/Mac|iPhone|iPad|iPod/i.test(navigator.userAgent || '')) return drop('mac');
    if (window.innerWidth < L.narrowW) return drop('narrow');
    var ls = window.localStorage;
    var tabs = ls.getItem('v3.chromeTabs');
    if (tabs !== null && tabs !== L.defaultTabsJson) return drop('tabs');
    if (ls.getItem('v3.railCollapsed') === '1') return drop('railCollapsed');
    if (ls.getItem('v3.agentsOpen') === '1') return drop('agentsOpen');
    var row = shell.querySelector('.s2-row');
    var chatOnly = row && row.getAttribute('data-stage') === 'none';
    /* Docked chat: a dragged width is TAKEN ON, clamped as React clamps it.
       Chat-only: React ignores v3.chatW while centred, so the frame must too. */
    if (!chatOnly) {
      var chatW = Number(ls.getItem('v3.chatW'));
      if (chatW > 0) {
        var w = Math.round(Math.min(L.chatMax, Math.max(L.chatMin, chatW)));
        var col = shell.querySelector('.v3-chat-col');
        if (col) {
          col.style.width = w + 'px';
          col.style.flexBasis = w + 'px';
        }
      }
    }
  } catch (e) {
    /* No storage: React reads the same defaults, so the frame still matches. */
  }
  scheduleChatOnlyShift();
  var splash = document.getElementById('boot-splash');
  if (splash && splash.parentNode) splash.parentNode.removeChild(splash);
  window.__sequenceStaticShell = { shownAt: performance.now(), firstKeyAt: null };
  var field = shell.querySelector('[data-testid="composer-field"]');
  if (!field) return;
  function pend() {
    shell.setAttribute('data-pending-send', '1');
  }
  field.addEventListener('keydown', function (e) {
    if (window.__sequenceStaticShell.firstKeyAt === null) window.__sequenceStaticShell.firstKeyAt = performance.now();
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      pend();
    }
  });
  var send = shell.querySelector('[data-testid="composer-send"]');
  if (send) send.addEventListener('click', function (e) {
    e.preventDefault();
    pend();
  });
  try {
    field.focus();
  } catch (e) {
    /* focus is a courtesy */
  }
})();
