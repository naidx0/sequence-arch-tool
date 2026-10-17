/**
 * The helper scripts the main process writes and runs for an update. They are CONSTANT text: nothing from the handoff
 * file, the server or the network is ever spliced into them. Every variable part reaches them as an environment
 * variable or a positional argument that main chose itself (updateHandoff.ts).
 */

/** Windows portable folder. Reads SEQ_PID, SEQ_ZIP, SEQ_STAGE, SEQ_APP, SEQ_EXE and SEQ_DELETE from the environment. */
export const PORTABLE_HELPER_SCRIPT: string = [
  '@echo off',
  'setlocal DisableDelayedExpansion',
  /* One blocking call, no polling loop: Wait-Process returns at once when the pid is already gone. */
  '"%SystemRoot%\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" -NoProfile -NonInteractive -WindowStyle Hidden -Command "Wait-Process -Id ([int]$env:SEQ_PID) -ErrorAction SilentlyContinue"',
  'if exist "%SEQ_STAGE%" rmdir /S /Q "%SEQ_STAGE%"',
  'mkdir "%SEQ_STAGE%"',
  /* System32 tar reads zip; a tar earlier on the PATH (Git's) does not. */
  '"%SystemRoot%\\System32\\tar.exe" -xf "%SEQ_ZIP%" -C "%SEQ_STAGE%"',
  'if errorlevel 1 goto restart',
  /* /E copies subfolders; there is no /MIR or /PURGE, so nothing is removed by the copy. */
  '"%SystemRoot%\\System32\\robocopy.exe" "%SEQ_STAGE%" "%SEQ_APP%" /E /R:5 /W:1 /NFL /NDL /NJH /NJS /NP >NUL',
  'if errorlevel 8 goto restart',
  /* Then only the files main listed (each was in the old manifest and is not in the new one). */
  'if exist "%SEQ_DELETE%" for /f "usebackq delims=" %%F in ("%SEQ_DELETE%") do del /f /q "%SEQ_APP%\\%%F" 2>NUL',
  ':restart',
  'rmdir /S /Q "%SEQ_STAGE%" 2>NUL',
  'del /f /q "%SEQ_ZIP%" 2>NUL',
  'start "" /B "%SEQ_APP%\\%SEQ_EXE%"',
  /* A batch file cannot delete itself while it runs, except through this idiom: (goto) ends it, then del runs. */
  '(goto) 2>NUL & del "%~f0"',
  '',
].join('\r\n');

/** macOS. Positional: $1 app pid, $2 the verified update zip, $3 the running .app, $4 a temp folder beside it. */
export const MAC_SWAP_SCRIPT: string = [
  '#!/bin/sh',
  '# Replaces the running Sequence.app with the unpacked, verified update once Sequence has quit, then opens it.',
  'PID="$1"; ZIP="$2"; APP="$3"; TMP="$4"',
  'while kill -0 "$PID" 2>/dev/null; do',
  '  sleep 1',
  'done',
  'rm -rf "$TMP"',
  'if ! mkdir "$TMP"; then open "$APP"; exit 1; fi',
  'if ! ditto -x -k "$ZIP" "$TMP"; then rm -rf "$TMP"; open "$APP"; exit 1; fi',
  'NEW=""',
  'for f in "$TMP"/*.app; do NEW="$f"; break; done',
  'if [ -z "$NEW" ] || [ ! -d "$NEW" ]; then rm -rf "$TMP"; open "$APP"; exit 1; fi',
  'xattr -dr com.apple.quarantine "$NEW" 2>/dev/null',
  'OLD="$APP.old-$$"',
  'if ! mv "$APP" "$OLD"; then rm -rf "$TMP"; open "$APP"; exit 1; fi',
  'if mv "$NEW" "$APP"; then',
  '  rm -rf "$OLD"',
  'else',
  '  mv "$OLD" "$APP"',
  '  rm -rf "$TMP"',
  '  open "$APP"',
  '  exit 1',
  'fi',
  'rm -rf "$TMP"',
  'rm -f "$ZIP"',
  'open "$APP"',
  '',
].join('\n');

/** Linux AppImage. Positional: $1 app pid, $2 the staged new AppImage (beside the old one), $3 the AppImage to replace. */
export const APPIMAGE_SWAP_SCRIPT: string = [
  '#!/bin/sh',
  '# Replaces the running AppImage with the verified new one once Sequence has quit, then starts it.',
  'PID="$1"; NEW="$2"; TARGET="$3"',
  'while kill -0 "$PID" 2>/dev/null; do',
  '  sleep 1',
  'done',
  'chmod 755 "$NEW" 2>/dev/null',
  'if mv -f "$NEW" "$TARGET"; then',
  '  exec "$TARGET"',
  'fi',
  '# the swap failed: leave the old one in place and start it',
  'rm -f "$NEW"',
  'exec "$TARGET"',
  '',
].join('\n');
