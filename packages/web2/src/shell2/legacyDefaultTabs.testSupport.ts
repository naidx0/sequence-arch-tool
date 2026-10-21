/* Until 0.1.8.4 a profile with no stored layout booted with Architecture open. Suites whose question is about an open
   surface (dividers, the folded sidebar, the pane head) store that layout, instead of leaning on the default. */
export function seedOpenArchitecture(): void {
  localStorage.setItem('v3.chromeTabs', JSON.stringify({ tabs: [{ id: 'chat', minimized: false }, { id: 'architecture', minimized: false }], active: 'architecture' }));
}
