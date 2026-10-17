/* The shared sanitiser: only path and shape elements survive, every colour becomes currentColor. */
const SHAPES = new Set(['path', 'circle', 'ellipse', 'rect', 'polygon', 'polyline', 'line', 'g']);
const KEEP = new Set(['d', 'cx', 'cy', 'r', 'rx', 'ry', 'x', 'y', 'width', 'height', 'points', 'x1', 'y1', 'x2', 'y2', 'transform', 'fill-rule', 'clip-rule', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit', 'opacity', 'fill-opacity', 'stroke-opacity']);

export function sanitise(svg, cap = 3500) {
  /* A clip path that only trims to the canvas is dropped, with its attribute. */
  if (!/<(linearGradient|radialGradient|pattern|mask|filter)\b/i.test(svg)) svg = svg.replace(/<defs>[\s\S]*?<\/defs>/gi, (d) => (/^<defs>\s*(<clipPath\b[\s\S]*?<\/clipPath>\s*)+<\/defs>$/i.test(d.trim()) ? '' : d)).replace(/\sclip-path="[^"]*"/gi, '');
  if (/<(image|style|script|linearGradient|radialGradient|pattern|mask|clipPath|filter|foreignObject|use|text)\b/i.test(svg) || /\son[a-z]+\s*=/i.test(svg) || /(href|url\()/i.test(svg.replace(/xmlns(:xlink)?="[^"]*"/g, ''))) return null;
  const root = /<svg\b([^>]*)>/i.exec(svg);
  if (!root) return null;
  const vb = /viewBox="([^"]+)"/i.exec(root[1])?.[1];
  if (!vb) return null;
  const rootFill = /\sfill="([^"]*)"/i.exec(root[1])?.[1];
  const body = svg.slice(root.index + root[0].length, svg.lastIndexOf('</svg>'));
  let out = '';
  const re = /<(\/?)([a-zA-Z]+)((?:\s+[^<>]*?)?)(\/?)>/g;
  let m;
  while ((m = re.exec(body))) {
    const [, close, tag, attrs, self] = m;
    const t = tag.toLowerCase();
    if (!SHAPES.has(t)) { if (t === 'defs' || t === 'title' || t === 'desc' || t === 'metadata') continue; return null; }
    if (close) { out += `</${t}>`; continue; }
    let a = '';
    for (const [, k, v] of attrs.matchAll(/([a-zA-Z:-]+)\s*=\s*"([^"]*)"/g)) {
      if (k === 'fill' || k === 'stroke') {
        if (v === 'none') a += ` ${k}="none"`;
        else if (/^(white|#fff|#ffffff|#f5f5f5)$/i.test(v)) return null;
        else a += ` ${k}="currentColor"`;
      } else if (KEEP.has(k)) a += ` ${k}="${v.replace(/\s+/g, ' ').trim()}"`;
    }
    out += `<${t}${a}${self ? '/' : ''}>`;
  }
  out = out.replace(/\s+/g, ' ').trim().replace(/(\d+)\.(\d{3})\d+/g, '$1.$2').replace(/(\.\d*?)0+(?=\D)/g, '$1');
  if (!out || out.length > cap) return null;
  return { vb, rootFill: rootFill === 'none' ? 'none' : '', body: out };
}

