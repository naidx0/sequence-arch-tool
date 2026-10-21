import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { groupFilesUnder } from '../scan/fileGroups.js';

test('groups nested service directories in walk order, with segment boundaries and empty roots', () => {
  const root = path.resolve('specimen');
  const rels = ['apps/a/z.ts', 'apps/ab/only.ts', 'root.ts', 'apps/a/nested/b.ts', 'apps/a/a.ts'];
  const files = rels.map((f) => path.join(root, f));
  const dirs = [root, path.join(root, 'apps/a'), path.join(root, 'apps/a/nested'), path.join(root, 'empty')];
  const grouped = groupFilesUnder(files, [...dirs, dirs[1]]);
  for (const dir of dirs) {
    assert.deepEqual(grouped.get(dir), files.filter((f) => f.startsWith(dir + path.sep)));
  }
  assert.deepEqual(grouped.get(dirs[1]), [files[0], files[3], files[4]]);
  assert.deepEqual(grouped.get(dirs[3]), []);
  assert.deepEqual(groupFilesUnder(files, []).size, 0);
  assert.deepEqual(groupFilesUnder([], dirs).get(root), []);
  const volume = path.parse(root).root;
  assert.deepEqual(groupFilesUnder(files, [volume]).get(volume), files);
});

test('adding service roots does not reread the complete file set per service', () => {
  const root = path.resolve('specimen');
  const files = Array.from({ length: 128 }, (_, i) => path.join(root, `app-${i}`, 'src', 'index.ts'));
  const dirs = files.map((f) => path.dirname(path.dirname(f)));
  let reads = 0;
  const observed = new Proxy(files, {
    get(target, key, receiver) {
      if (typeof key === 'string' && /^\d+$/.test(key)) reads++;
      return Reflect.get(target, key, receiver);
    },
  });
  const groups = groupFilesUnder(observed, dirs);
  for (let i = 0; i < files.length; i++) assert.deepEqual(groups.get(dirs[i]), [files[i]]);
  assert.ok(reads <= files.length * 2, `read ${reads} file entries for ${files.length} inputs; service count must not multiply the walk`);
});
