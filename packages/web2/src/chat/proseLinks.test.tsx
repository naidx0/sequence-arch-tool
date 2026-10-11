import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ProseMessage } from './ProseMessage';

/* UX audit: codex's answers cited files as raw 70-character Windows paths. A
   file link reads as its label, with the whole path on hover. */
describe("an answer's file links", () => {
  it('shows the label, not the path; the path is the title; a web link opens in a new tab', () => {
    const path = 'C:\\Users\\dev\\AppData\\Local\\Temp\\seq-ux-work-N8rTo5\\shopfront\\orders\\app\\main.py';
    render(<ProseMessage text={`Added ping() in [main.py](${path}); docs at [ACP](https://agentclientprotocol.com).`} />);
    const file = screen.getByTestId('chat-path');
    expect(file.textContent).toBe('main.py');
    expect(file.getAttribute('title')).toBe(path);
    expect(document.body.textContent).not.toContain('AppData');
    const web = screen.getByRole('link', { name: 'ACP' });
    expect(web.getAttribute('href')).toBe('https://agentclientprotocol.com');
    expect(web.getAttribute('rel')).toBe('noopener noreferrer');
  });
});
