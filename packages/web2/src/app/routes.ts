/**
 * THERE ARE NO ROUTES. This file exists to say so, and to stop the question
 * being reopened once a quarter by whoever notices there is no router.
 *
 * Sequence is one canvas. The v2 plan's §2.3 says so in one line — "the one
 * screen" — and a router would immediately contradict it by making the shell
 * unmountable, the canvas viewport disposable, and the back button a way to
 * lose a scan.
 *
 * NAVIGATION IS STATE. Two fields carry all of it:
 *
 *     dialog:    'connect' | 'settings' | 'tools' | null
 *     inspector: { open: boolean; subject: … }
 *
 * Each is CONDITIONALLY MOUNTED, never hidden behind display:none. The reason
 * is recorded and is an accessibility one, not a performance one: leaving
 * panes in the DOM behind display:none duplicated every pane's rows AND its
 * landmark, so a screen reader met the same pane twice. Mount it or do not
 * render it; there is no third option.
 *
 * THE ONE ROOT BRANCH, deferred to Wave 2. Tearing a board into its own window
 * is a real capability, and it is a branch at the ROOT — before the tree, not
 * inside it:
 *
 *     parsePopoutSurface(window.location.search) ? <PopoutShell/> : <App/>
 *
 * It is not written yet: the v1 popout parser died with `packages/web`
 * (deleted 2026-08-20). When a popout wave needs it, rewrite the parser in
 * web2 against the same query-string contract — never restore or import from
 * the deleted package (docs/PIVOT-V2.md; test/firewall.test.ts).
 */

export {};
