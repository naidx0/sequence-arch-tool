import assert from 'node:assert/strict';
import { test } from 'node:test';

import { renderVisual } from '@sequence/schema/dist/visual/index.js';

import { DRAWING_EXAMPLES, DRAWING_RULES, DRAW_INSTRUCTION } from '../accessMode.js';

test('the drawing guidance carries the rules the owner asked for (key lines)', () => {
  const lines = DRAWING_RULES.split('\n');
  assert.equal(lines.length, 9);
  assert.match(lines[0]!, /about 440 px wide and any height is fine, so draw tall, not wide/);
  assert.match(lines[1]!, /Top to bottom, always: .*stack downward.*Never more than 3 boxes in a row; a wider picture is split or stacked/);
  assert.match(lines[2]!, /viewBox width 420 \(never over 480\), no fixed width or height; at most 8 boxes/);
  assert.match(lines[3]!, /1 to 4 words per box \(28 characters at most\).*never under 11; no text over text or on a border; an arrow label goes beside its arrow/);
  assert.match(lines[4]!, /one title/);
  assert.match(lines[5]!, /visual tool/);
  assert.match(lines[6]!, /no emoji or pictographs.*theme variables above.*one accent use at most.*hairlines.*rx 8.*font inherit.*no gradients or shadows/);
  assert.match(lines[7]!, /^7\. html: only kit classes: seq-card, seq-btn \(seq-btn primary: at most one, interactive demos only\), seq-chip, seq-row, seq-stack, seq-muted\. No own <style>, inline colours, gradients, shadows or custom fonts\. Prefer text and chips to buttons\.$/);
  assert.match(lines[8]!, /^8\. Components: our kit first, then UIArc\.dev for new ones; anything else, search shadcn first\. Icons likewise\.$/);
  assert.ok(DRAW_INSTRUCTION.length <= 3433 + 150, `the drawing instruction grew by ${DRAW_INSTRUCTION.length - 3433} characters; the budget is +150`);
  assert.doesNotMatch(lines[6]!, /--seq-/, 'the variable list is not repeated: the base line has it');
  assert.match(DRAW_INSTRUCTION, /--seq-bg, --seq-fg, --seq-muted, --seq-accent, --seq-edge, --seq-surface/);
  assert.ok(DRAW_INSTRUCTION.includes(DRAWING_RULES) && DRAW_INSTRUCTION.includes(DRAWING_EXAMPLES), 'every agent gets the rules and the examples');
});

test('the five examples are valid: the visual ones draw within the column, the svg is one narrow, titled svg', () => {
  const rows = DRAWING_EXAMPLES.split('\n');
  assert.equal(rows.length, 5);
  for (const row of rows.slice(0, 3)) {
    const json = row.slice(row.indexOf('{'));
    const { component, spec } = JSON.parse(json) as { component: string; spec: unknown };
    const r = renderVisual(component, spec, { width: 440 });
    assert.ok(r.width <= 440, `${component} fits the column`);
    assert.ok(r.height <= 420, `${component} is not taller than the card maximum`);
  }
  const svg = rows[3]!.slice(rows[3]!.indexOf('<svg'));
  assert.match(svg, /^<svg viewBox="0 0 (\d+) \d+"/);
  assert.ok(Number(/viewBox="0 0 (\d+)/.exec(svg)![1]) <= 480);
  assert.doesNotMatch(svg, /<svg[^>]* (width|height)=/);
  assert.match(svg, /<title>[^<]+<\/title>/);
  assert.equal((svg.match(/<svg/g) ?? []).length, 1);
  for (const t of svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)) assert.ok(t[1]!.split(' ').length <= 4 && t[1]!.length <= 28, `short label: ${t[1]}`);
});

test('the html example uses only kit classes, no emoji, no inline colours', () => {
  const html = DRAWING_EXAMPLES.split(String.fromCharCode(10))[4]!;
  assert.match(html, /^html: <div class="seq-card seq-stack">/);
  assert.doesNotMatch(html, /\p{Extended_Pictographic}/u);
  assert.doesNotMatch(html, /style=|#[0-9a-f]{3,6}|rgb\(/i);
  assert.doesNotMatch(html, /<button|<style/, 'no button unless the drawing is a demo, and no own <style>');
  for (const m of html.matchAll(/class="([^"]+)"/g)) for (const c of m[1]!.split(' ')) assert.match(c, /^(seq-[a-z]+|primary)$/);
});
