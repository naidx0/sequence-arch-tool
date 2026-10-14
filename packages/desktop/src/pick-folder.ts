/* ══════════════════════════════════════════════════════════════════════════
   THE FOLDER DIALOG, AND NOTHING ELSE (0.1.8.1)
   packages/desktop/src/pick-folder.ts

   `sequence:open-repo` picks a folder AND attaches it. The clone's "Clone into"
   needs only the folder: the checkout is made there, by the server, after the
   reader presses Clone. So `sequence:pick-folder` runs the OS dialog and hands
   back the path, or null on Cancel. Electron-free so it is tested in CI; main.ts
   passes `dialog.showOpenDialog`.
   ══════════════════════════════════════════════════════════════════════════ */

export interface FolderDialogOptions {
  title: string;
  message: string;
  buttonLabel: string;
  properties: Array<'openDirectory' | 'createDirectory'>;
}

export const PICK_FOLDER_OPTIONS: FolderDialogOptions = {
  title: 'Choose a folder',
  message: 'Choose a new or empty folder for the project',
  buttonLabel: 'Choose',
  properties: ['openDirectory', 'createDirectory'],
};

export type ShowFolderDialog = (opts: FolderDialogOptions) => Promise<{ canceled: boolean; filePaths: string[] }>;

/** The folder chosen, or null when the dialog was cancelled or chose nothing. Never attaches anything. */
export async function pickFolder(show: ShowFolderDialog): Promise<string | null> {
  const result = await show(PICK_FOLDER_OPTIONS);
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0] ?? null;
}
