/**
 * Archify-style self-contained HTML export from a canvas document.
 * One file, offline-ready, with optional guided story navigation.
 *
 * Styles live in canvasExportTemplate.html (firewall-exempt) so portable
 * export can use fixed px/hex without polluting the Graphite token tree.
 */

import type { CanvasDoc, CanvasDocBlock } from '../state/types';

import exportTemplate from './canvasExportTemplate.html?raw';

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function blockBodyHtml(block: CanvasDocBlock): string {
  switch (block.type) {
    case 'markdown': {
      const lines = block.payload.split('\n');
      return lines
        .map((line) => {
          if (/^#{1,3}\s/.test(line)) {
            const level = line.match(/^#+/)![0].length;
            const text = escapeHtml(line.replace(/^#+\s*/, ''));
            return level === 1 ? `<h2>${text}</h2>` : level === 2 ? `<h3>${text}</h3>` : `<h4>${text}</h4>`;
          }
          if (line.trim() === '') return '';
          return `<p>${escapeHtml(line)}</p>`;
        })
        .filter(Boolean)
        .join('\n');
    }
    case 'html':
      return block.payload;
    case 'svg':
      return block.payload.trimStart().startsWith('<svg') ? block.payload : `<pre>${escapeHtml(block.payload)}</pre>`;
    default:
      return `<pre class="src">${escapeHtml(block.payload)}</pre>`;
  }
}

function blockHeading(block: CanvasDocBlock): string {
  const typeLabel = block.type.charAt(0).toUpperCase() + block.type.slice(1);
  return block.title ? `${typeLabel} · ${block.title}` : typeLabel;
}

function renderBlocks(doc: CanvasDoc): string {
  return doc.blocks
    .map(
      (b) => `<section class="block" id="block-${escapeHtml(b.id)}" data-block-id="${escapeHtml(b.id)}">
  <header class="block-hd">${escapeHtml(blockHeading(b))}</header>
  <div class="block-bd">${blockBodyHtml(b)}</div>
</section>`,
    )
    .join('\n');
}

function renderStoryNav(doc: CanvasDoc): string {
  const storySteps = doc.storyRoute?.steps ?? [];
  if (storySteps.length === 0) return '';
  return `<nav class="story-nav" id="story-nav">
  <div class="story-title">${escapeHtml(doc.storyRoute!.title)}</div>
  <ol class="story-steps">${storySteps
    .map(
      (s, i) =>
        `<li><button type="button" data-step="${i}" data-block="${escapeHtml(s.blockId)}">${escapeHtml(s.caption)}</button></li>`,
    )
    .join('')}</ol>
  <div class="story-controls">
    <button type="button" id="story-prev">Previous</button>
    <span id="story-index">1 / ${storySteps.length}</span>
    <button type="button" id="story-next">Next</button>
  </div>
</nav>`;
}

function renderStoryScript(doc: CanvasDoc): string {
  const storySteps = doc.storyRoute?.steps ?? [];
  if (storySteps.length === 0) return '';
  return `<script>
(function(){
  var steps=${JSON.stringify(storySteps.map((s) => s.blockId))};
  var idx=0;
  function show(i){
    idx=Math.max(0,Math.min(steps.length-1,i));
    document.querySelectorAll('.block').forEach(function(el){el.classList.remove('active');});
    var t=document.getElementById('block-'+steps[idx]);
    if(t){t.classList.add('active');t.scrollIntoView({behavior:'smooth',block:'start'});}
    document.getElementById('story-index').textContent=(idx+1)+' / '+steps.length;
    document.querySelectorAll('.story-steps button').forEach(function(b,j){b.classList.toggle('active',j===idx);});
  }
  document.getElementById('story-prev').onclick=function(){show(idx-1);};
  document.getElementById('story-next').onclick=function(){show(idx+1);};
  document.querySelectorAll('.story-steps button').forEach(function(b){
    b.onclick=function(){show(parseInt(b.getAttribute('data-step'),10));};
  });
  show(0);
})();
</script>`;
}

/** Build a portable HTML artifact the owner can open or share without Sequence. */
export function canvasDocToHtml(doc: CanvasDoc, opts?: { title?: string }): string {
  const pageTitle = escapeHtml(opts?.title ?? doc.storyRoute?.title ?? 'Sequence AI Canvas');
  return exportTemplate
    .replaceAll('{{TITLE}}', pageTitle)
    .replace('{{STORY_NAV}}', renderStoryNav(doc))
    .replace('{{BLOCKS}}', renderBlocks(doc))
    .replace('{{STORY_SCRIPT}}', renderStoryScript(doc));
}

export function downloadCanvasHtml(doc: CanvasDoc, filename = 'sequence-canvas.html'): void {
  const html = canvasDocToHtml(doc);
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
