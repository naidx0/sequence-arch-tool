#!/usr/bin/env node
// Transcript, empty prompts and virtual rows share the composer's horizontal rails.
import { sel, settle, suite, within } from './lib/harness.mjs';

await suite('chat-composer-align', async ({page, base, check, log}) => {
  for (const [width, surface] of [[1440, true], [1440, false], [420, false]]) {
    await page.setViewportSize({width, height:900});
    await page.addInitScript((open) => {
      localStorage.setItem('v3.chromeTabs', JSON.stringify({tabs:[{id:'chat', minimized:false}, ...(open ? [{id:'architecture', minimized:false}] : [])], active:open?'architecture':'chat'}));
    }, surface);
    await page.goto(base);
    await page.waitForSelector(sel('shell'));
    await settle(page);
    await check(`${width}, surface=${surface}: plain and virtual message rails align with composer`, async () => {
      const boxes = await page.evaluate(() => {
        const transcript=document.querySelector('.v3-transcript');
        const composer=document.querySelector('.s2-comp').getBoundingClientRect();
        const measure=(parent) => {
          const el=document.createElement('div');
          el.textContent='A real line of text';
          parent.appendChild(el);
          const r=el.getBoundingClientRect();
          el.remove();
          return {left:r.left,right:r.right};
        };
        const plain=measure(transcript);
        const list=document.createElement('div');
        list.className='v3-vlist';
        list.style.cssText='width:100%;height:40px;overflow:auto';
        const row=document.createElement('div');row.className='v3-vrow';
        list.appendChild(row);transcript.parentElement.appendChild(list);
        const virtual=measure(row);list.remove();
        return {plain,virtual,composer:{left:composer.left,right:composer.right}};
      });
      log(JSON.stringify(boxes));
      for(const kind of ['plain','virtual']) for(const edge of ['left','right']) within(boxes[kind][edge], boxes.composer[edge], 1.5, `${kind} ${edge}`);
    });
  }
});
