// Generic helpers: the URL here is a hole-only parameter. The analyzer must
// NOT emit an edge from this wrapper itself — only from call sites that pass
// a resolvable URL.
export async function getJson(url: string): Promise<unknown> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`GET ${url} -> ${r.status}`);
  return r.json();
}

export async function postJson(url: string, body: unknown): Promise<unknown> {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`POST ${url} -> ${r.status}`);
  return r.json();
}
