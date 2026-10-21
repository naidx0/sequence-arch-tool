#!/usr/bin/env node
// Owner 0.1.8.4: no horizontal scrolling; every workspace remains reachable.
import { is, sel, settle, suite } from './lib/harness.mjs';
await suite('workspace-nav-fit', async ({page,base,check,log}) => {
  for(const width of [1440,1024,760,420]) {
    await page.setViewportSize({width,height:900});
    await page.addInitScript(() => localStorage.setItem('v3.chromeTabs',JSON.stringify({tabs:[{id:'chat',minimized:false},{id:'architecture',minimized:false}],active:'architecture'})));
    await page.goto(base);await page.waitForSelector(sel('shell'));await settle(page);
    const workspace=page.getByTestId('s2-narrow-stage');
    if(await workspace.isVisible()) {await workspace.click();await settle(page);}
    const bar=page.getByTestId('s2-surfaces');
    await check(`${width}: all workspace controls fit without horizontal scrolling`,async()=>{
      const m=await bar.evaluate(el=>{const b=el.getBoundingClientRect();return {width:el.clientWidth,scroll:el.scrollWidth,controls:[...el.querySelectorAll('button')].filter(x=>x.getBoundingClientRect().width>0).map(x=>{const r=x.getBoundingClientRect();return {name:x.getAttribute('aria-label'),title:x.title,left:r.left,right:r.right};}),left:b.left,right:b.right};});
      log(width,JSON.stringify(m));
      if(m.scroll>m.width+1) throw Error(`nav scrolls: ${m.scroll}>${m.width}`);
      is(m.controls.length>=6,true,'all workspace buttons present');
      for(const c of m.controls){is(!!c.name&&!!c.title,true,'accessible name and tooltip');if(c.left<m.left-1||c.right>m.right+1)throw Error(`${c.name} outside nav`);}
    });
    await check(`${width}: switch workspace and close current surface through visible controls`,async()=>{
      await page.getByTestId('s2-tab-files').click();await settle(page);
      const close=page.getByTestId('v3-tab-close-files');is(await close.isVisible(),true,'current surface close visible');await close.click();await settle(page);
      is(await page.getByTestId('s2-tab-files').getAttribute('aria-pressed'),'false','surface closed');
    });
  }
});
