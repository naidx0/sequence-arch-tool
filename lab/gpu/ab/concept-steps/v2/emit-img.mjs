// Blind screenshot pairs for concept chart v2: only items whose picture changed; both orders.
import fs from 'node:fs';
const S = process.argv[2];
const R = `${S}/render3`;
const items = JSON.parse(fs.readFileSync(`${R}/items.json`, 'utf8')).filter((x) => !x.identical);
fs.mkdirSync(`${S}/judge2/img`, { recursive: true });
const map = [];
let k = 0;
const blocks = [];
for (const it of items) {
  const nn = String(it.n).padStart(2, '0');
  for (const order of ['off-cap', 'cap-off']) {
    k++;
    const [first, second] = order.split('-');
    const id = `p${String((k * 37) % 101).padStart(3, '0')}`;
    fs.copyFileSync(`${R}/item${nn}-${first}.png`, `${S}/judge2/img/${id}-1.png`);
    fs.copyFileSync(`${R}/item${nn}-${second}.png`, `${S}/judge2/img/${id}-2.png`);
    map.push([id, it.n, order]);
    blocks.push({ id, text: `########## ITEM ${id}
A person learning a codebase asked: "${it.question}"
Beside the lesson, the app shows a picture. Picture 1: ${S}/judge2/img/${id}-1.png  Picture 2: ${S}/judge2/img/${id}-2.png
Which picture better helps this person understand what they asked (what connects to what, and what travels between them)? Also say whether either picture has text that is clipped, overlapping or unreadable.
Reply JSON: {"visual":"1|2|tie","clipped":"none|1|2|both","why":"one sentence"}
` });
  }
}
blocks.sort((a, b) => a.id.localeCompare(b.id));
fs.writeFileSync(`${S}/judge2/items.md`, blocks.map((b) => b.text).join('\n'));
fs.writeFileSync(`${S}/judge2/map.json`, JSON.stringify(map));
console.log(`items ${items.length}, prompts ${blocks.length}`);
