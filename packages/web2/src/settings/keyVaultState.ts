import { useEffect, useState } from 'react';

/**
 * APP-11. Whether API keys are encrypted by the OS store or sit unencrypted in a file, as the desktop's
 * main process reports it through the preload bridge (`window.sequence.keyVault`, a key on the existing
 * bridge, not a new global). Browser mode has no bridge and keeps keys in the plain user file, so it
 * always gets the plain sentence. Read-only; no key ever crosses this.
 */
export interface KeyVaultInfo {
  state: 'sealed' | 'plain';
  /** The file keys live in when plain. */
  path: string | null;
}

/** Where browser mode (`pnpm app`) keeps keys; the desktop reports its real path instead. */
export const BROWSER_KEY_FILE = '~/.sequence/ai.json';

export const SEALED_HINT = 'Stored in your system keychain.';

/** The sentence under the key box. Shown before Save. */
export function keyVaultHint(info: KeyVaultInfo): string {
  if (info.state === 'sealed') return SEALED_HINT;
  return `No system keychain found. Stored unencrypted in ${info.path ?? BROWSER_KEY_FILE}, readable only by your user.`;
}

type Bridge = { keyVault?: () => Promise<unknown> };

function bridgeOf(): Bridge | undefined {
  if (typeof window === 'undefined') return undefined;
  return (window as unknown as { sequence?: Bridge }).sequence ?? undefined;
}

/**
 * The vault state, or null while the desktop is still answering. No bridge (browser mode) is answered
 * at once with the plain state; a bridge that fails or answers nonsense is plain too, the safe side.
 */
export function useKeyVault(): KeyVaultInfo | null {
  const asks = typeof bridgeOf()?.keyVault === 'function';
  const [info, setInfo] = useState<KeyVaultInfo | null>(asks ? null : { state: 'plain', path: null });
  useEffect(() => {
    const ask = bridgeOf()?.keyVault;
    if (typeof ask !== 'function') return;
    let live = true;
    void Promise.resolve()
      .then(() => ask())
      .then((v) => {
        const o = v as { state?: unknown; path?: unknown } | null;
        if (!live) return;
        if (o && o.state === 'sealed') setInfo({ state: 'sealed', path: null });
        else setInfo({ state: 'plain', path: o && typeof o.path === 'string' ? o.path : null });
      })
      .catch(() => {
        if (live) setInfo({ state: 'plain', path: null });
      });
    return () => {
      live = false;
    };
  }, []);
  return info;
}
