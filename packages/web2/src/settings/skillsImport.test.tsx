import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { SkillsImport, type SkillsPost } from './SkillsImport';
import { gatherSkillFiles, slugify } from './skillsFiles';

/* Round 13 (N6): skills import by choosing or dropping files and folders. */

const f = (text: string, name: string, rel?: string) => {
  const file = new File([text], name, { type: 'text/markdown' });
  if (rel) Object.defineProperty(file, 'webkitRelativePath', { value: rel });
  return file;
};
const pick = (path: string, text = 'x') => ({ path, file: f(text, path.split('/').pop()!) });

describe('skillsFiles', () => {
  it('keeps a skill folder as it is', async () => {
    const r = await gatherSkillFiles([pick('shop-rules/SKILL.md', '---\nname: Shop\n---\n'), pick('shop-rules/notes.txt')]);
    expect(r.error).toBeNull();
    expect(r.slugs).toEqual(['shop-rules']);
    expect(r.files.map((x) => x.path)).toEqual(['shop-rules/SKILL.md', 'shop-rules/notes.txt']);
  });

  it('takes another project skills folder: drops the outer folder name, imports each skill', async () => {
    const r = await gatherSkillFiles([pick('skills/a/SKILL.md'), pick('skills/b/SKILL.md'), pick('skills/b/extra.md'), pick('skills/README.md')]);
    expect(r.slugs.sort()).toEqual(['a', 'b']);
    expect(r.files.map((x) => x.path).sort()).toEqual(['a/SKILL.md', 'b/SKILL.md', 'b/extra.md']);
  });

  it('a loose SKILL.md is named by its name field; a loose note by its file name', async () => {
    const r = await gatherSkillFiles([pick('SKILL.md', '---\nname: Release Checks\n---\nbody'), pick('Gate First.md', 'plain')]);
    expect(r.files.map((x) => x.path).sort()).toEqual(['gate-first/SKILL.md', 'release-checks/SKILL.md']);
  });

  it('says in words what it leaves out, and refuses when nothing is a skill', async () => {
    const r = await gatherSkillFiles([pick('a/SKILL.md'), { path: 'a/logo.png', file: f('x', 'logo.png') }, pick('b/readme.md'), pick('.hidden/c/SKILL.md')]);
    expect(r.files.map((x) => x.path)).toEqual(['a/SKILL.md']);
    expect(r.skipped).toEqual(expect.arrayContaining(['logo.png (not a text file)', 'b (no SKILL.md inside)']));
    const none = await gatherSkillFiles([pick('x/readme.md')]);
    expect(none.error).toMatch(/No skill found/);
  });

  it('checks the total size before any upload and says how much to cut', async () => {
    const big = 'x'.repeat(200 * 1024);
    const r = await gatherSkillFiles(['a', 'b', 'c', 'd', 'e'].map((n) => pick(`${n}/SKILL.md`, big)));
    expect(r.files).toEqual([]);
    expect(r.error).toMatch(/add up to 1000 KB\. Import at most 800 KB at once/);
  });

  it('slugifies to names the server accepts', () => {
    expect(slugify('Gate First.md')).toBe('gate-first');
    expect(slugify('***')).toBe('');
  });
});

describe('SkillsImport', () => {
  it('a chosen folder is sent as slug paths and the list is refreshed', async () => {
    const post: SkillsPost = vi.fn(async () => ({ status: 200, body: { imported: ['shop-rules'] } }));
    const onImported = vi.fn();
    render(<SkillsImport post={post} onImported={onImported} />);
    fireEvent.change(screen.getByTestId('settings-skills-folder'), { target: { files: [f('# s', 'SKILL.md', 'shop-rules/SKILL.md')] } });
    await waitFor(() => expect(onImported).toHaveBeenCalled());
    expect(post).toHaveBeenCalledWith([{ path: 'shop-rules/SKILL.md', content: '# s' }], false);
    expect(screen.getByTestId('settings-skills-imported').textContent).toBe('Imported shop-rules.');
    expect(screen.getByTestId('settings-skills-import-hint').getAttribute('title')).toMatch(/copy from another project, choose its skills folder/);
  });

  it('a name that exists asks first, and Replace sends overwrite', async () => {
    const post = vi
      .fn<Parameters<SkillsPost>, ReturnType<SkillsPost>>()
      .mockResolvedValueOnce({ status: 409, body: { error: 'already exists: a', conflicts: ['a'] } })
      .mockResolvedValueOnce({ status: 200, body: { imported: ['a'] } });
    const onImported = vi.fn();
    render(<SkillsImport post={post} onImported={onImported} />);
    fireEvent.change(screen.getByTestId('settings-skills-file'), { target: { files: [f('# s', 'SKILL.md', 'a/SKILL.md')] } });
    expect((await screen.findByTestId('settings-skills-conflict')).textContent).toMatch(/a is already here/);
    expect(onImported).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('settings-skills-replace'));
    await waitFor(() => expect(onImported).toHaveBeenCalled());
    expect(post).toHaveBeenLastCalledWith([{ path: 'a/SKILL.md', content: '# s' }], true);
  });

  it('a drop imports too, and a refusal from the server is shown in its words', async () => {
    const post: SkillsPost = vi.fn(async () => ({ status: 400, body: { error: 'too much at once' } }));
    render(<SkillsImport post={post} onImported={() => {}} />);
    fireEvent.drop(screen.getByTestId('settings-skills-import'), { dataTransfer: { files: [f('# s', 'SKILL.md', 'a/SKILL.md')], items: [], types: ['Files'] } });
    expect((await screen.findByTestId('settings-skills-import-failure')).textContent).toBe('too much at once');
  });
});

describe('SkillsImport: find skills', () => {
  it('"Find skills on this computer" dispatches seq:open-skills-finder and nothing else', () => {
    const seen: string[] = [];
    const on = (e: Event) => seen.push(e.type);
    window.addEventListener('seq:open-skills-finder', on);
    const post = vi.fn();
    render(<SkillsImport post={post as unknown as SkillsPost} onImported={() => {}} />);
    fireEvent.click(screen.getByTestId('settings-skills-find'));
    window.removeEventListener('seq:open-skills-finder', on);
    expect(seen).toEqual(['seq:open-skills-finder']);
    expect(post).not.toHaveBeenCalled();
  });
});
