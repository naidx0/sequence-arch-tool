/* THE STATIC SHELL'S PRE-PAINT SCRIPT, inlined into dist/index.html by
   prerender-shell.mjs right after #static-shell. Plain ES5, no imports.

   1. KEEP THE FRAME ONLY WHEN IT MATCHES what React will draw: the frame is
      the default layout, so a stored layout that differs (other tabs, a
      folded sidebar, the Agents panel open, a narrow window's switched
      layout, a Mac's title bar) removes it, and the splash stays as before.
      A dragged chat width is the one stored layout the frame takes on.
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
  try {
    if (/Mac|iPhone|iPad|iPod/i.test(navigator.userAgent || '')) return drop('mac');
    if (window.innerWidth < L.narrowW) return drop('narrow');
    var ls = window.localStorage;
    var tabs = ls.getItem('v3.chromeTabs');
    if (tabs !== null && tabs !== L.defaultTabsJson) return drop('tabs');
    if (ls.getItem('v3.railCollapsed') === '1') return drop('railCollapsed');
    if (ls.getItem('v3.agentsOpen') === '1') return drop('agentsOpen');
    /* A dragged chat width is TAKEN ON, clamped as React clamps it, so the
       frame still matches what React draws. */
    var chatW = Number(ls.getItem('v3.chatW'));
    if (chatW > 0) {
      var w = Math.round(Math.min(L.chatMax, Math.max(L.chatMin, chatW)));
      var col = shell.querySelector('.v3-chat-col');
      if (col) {
        col.style.width = w + 'px';
        col.style.flexBasis = w + 'px';
      }
    }
  } catch (e) {
    /* No storage: React reads the same defaults, so the frame still matches. */
  }
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
