import { describe, expect, it } from 'vitest';

import { EXPORT_FORMATS, fetchExport } from './exportClient';

const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });

describe('export client', () => {
  it('asks GET /api/export for the format and returns the file', async () => {
    let asked = '';
    const r = await fetchExport('matrix-csv', (async (u: string) => {
      asked = u;
      return json({ format: 'matrix-csv', filename: 'shop-architecture.csv', mime: 'text/csv', content: 'a,b\n' });
    }) as typeof fetch);
    expect(asked).toBe('/api/export?format=matrix-csv');
    expect(r).toEqual({ ok: true, file: { format: 'matrix-csv', filename: 'shop-architecture.csv', mime: 'text/csv', content: 'a,b\n' } });
    expect(EXPORT_FORMATS).toEqual(['mermaid-flow', 'matrix-csv', 'arch-md']);
  });

  it('carries the server words for a 409 and survives a network failure', async () => {
    const no = await fetchExport('arch-md', (async () => json({ error: 'no repo attached' }, 409)) as typeof fetch);
    expect(no).toEqual({ ok: false, status: 409, message: 'no repo attached' });
    const down = await fetchExport('arch-md', (async () => { throw new Error('offline'); }) as typeof fetch);
    expect(down).toEqual({ ok: false, status: 0, message: 'offline' });
  });
});
