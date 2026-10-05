import assert from 'node:assert/strict';
import test from 'node:test';
import {typescriptLoader} from './helpers/load-typescript.mjs';
const {groupBy} = typescriptLoader()('lib/collections.ts');

test('grouping preserves row identity, order, roots and missing groups', () => {
  const rows = [{id: 1, parent: null}, {id: 2, parent: 1}, {id: 3, parent: null}, {id: 4, parent: 1}];
  const groups = groupBy(rows, (row) => row.parent);
  assert.deepEqual(groups.get(null), [rows[0], rows[2]]);
  assert.deepEqual(groups.get(1), [rows[1], rows[3]]);
  assert.equal(groups.get(1)[0], rows[1]);
  assert.equal(groups.get('missing'), undefined);
  assert.equal(groupBy([], () => null).size, 0);
});

test('large thread indexing visits each message once instead of once per thread', () => {
  const rows = Array.from({length: 20000}, (_, i) => ({parent: i % 1000}));
  let visited = 0;
  const groups = groupBy(rows, (row) => {visited++; return row.parent;});
  for (let i = 0; i < 1000; i++) assert.equal(groups.get(i).length, 20);
  assert.equal(visited, rows.length);
});
