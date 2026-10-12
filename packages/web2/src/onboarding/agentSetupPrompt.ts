/* ══════════════════════════════════════════════════════════════════════════
   SET UP IN CHAT
   packages/web2/src/onboarding/agentSetupPrompt.ts

   Some agent steps the app cannot do for a person: installing a vendor's CLI,
   updating it, finishing a sign-in that failed. For those, a button drafts a
   ready prompt into the chat composer and the agent does the steps. The
   command a step needs may appear inside the drafted prompt; it is never shown
   to the person as something to run.

   Pure text in, text out, plus one helper that puts it in the composer (after
   anything already typed). It sends nothing and runs nothing.
   ══════════════════════════════════════════════════════════════════════════ */

export type SetupNeed = 'install' | 'signIn' | 'update' | 'bridge' | 'attention' | 'none' | 'another' | 'localModel';

export interface SetupFacts {
  need: SetupNeed;
  /** The provider id (`claude`, `codex`). Unused for `none`. */
  id?: string;
  label?: string;
  /** What the probe read, e.g. `2.0.1`. */
  version?: string | null;
  /** The oldest version Sequence can drive, when the probe knows it. */
  minVersion?: string;
  installHint?: string;
  signInCommand?: string;
  adapterInstall?: string;
}

const NL = String.fromCharCode(10);

export function agentSetupPrompt(f: SetupFacts): string {
  const name = f.label ?? f.id ?? 'a coding agent';
  const lines: string[] = [];
  switch (f.need) {
    case 'install':
      lines.push(`I want to use ${name} in Sequence, but it is not installed on this computer. Please install it for me, then sign me in and connect it to Sequence.`);
      if (f.installHint) lines.push('', `The official install command is: ${f.installHint}`);
      break;
    case 'signIn':
      lines.push(`${name} is installed but signed out, and I could not finish signing in from Sequence. Please walk me through signing in (open whatever page I need) and then connect it to Sequence.`);
      if (f.signInCommand) lines.push('', `Its sign-in command is: ${f.signInCommand}`);
      break;
    case 'update':
      lines.push(`${name} on this computer is older than Sequence can drive. Please update it to the latest version for me, then connect it to Sequence.`);
      lines.push('', `Installed version: ${f.version ? f.version : 'unknown'}`, `Oldest version Sequence can drive: ${f.minVersion ?? 'unknown'}`);
      if (f.installHint) lines.push(`The official install command, which also updates it: ${f.installHint}`);
      break;
    case 'bridge':
      lines.push(`${name} is installed, but the small bridge Sequence uses to talk to it is missing or would not install. Please install the bridge for me and connect ${name} to Sequence.`);
      if (f.adapterInstall) lines.push('', `The bridge install command is: ${f.adapterInstall}`);
      break;
    case 'attention':
      lines.push(`Sequence could not read ${name}'s status on this computer. Please work out what is wrong, fix it, and connect it to Sequence.`);
      break;
    case 'another':
      lines.push('I want to add another coding agent to Sequence. Please check which coding agents (Claude Code, Codex, Gemini CLI, or another that Sequence can talk to) are installed on this computer, tell me which are not connected yet, then install, sign in and connect the one I pick.');
      break;
    case 'localModel':
      lines.push(`${name} is running on this computer but has no models loaded. Please pick a good model that fits this machine, download it into ${name}, and make it available in Sequence.`);
      break;
    case 'none':
      lines.push('I want to connect a coding agent to Sequence and none is connected yet. Please check whether Claude Code or Codex is installed on this computer, install what is missing, sign me in, and connect it.');
      break;
  }
  lines.push('', 'Do the steps for me where you can, and tell me plainly if you need me to click or approve something.');
  return lines.join(NL);
}

interface ComposerStore {
  getState(): { composer: { draft?: string | null } };
  dispatch(action: { type: 'composer/draft'; text: string }): unknown;
}

/** Puts the prompt in the chat composer after anything already typed. Sends nothing. */
export function draftIntoComposer(store: ComposerStore, prompt: string): void {
  const draft = store.getState().composer.draft ?? '';
  store.dispatch({ type: 'composer/draft', text: draft.trim() === '' ? prompt : `${draft.trimEnd()}${NL}${NL}${prompt}` });
}
