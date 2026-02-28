'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { JsonStore } = require('../server/db/json-store');

function tmpFile() {
  return path.join(os.tmpdir(), `contextfs-test-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
}

afterEach(() => {
  // cleanup is done per test
});

describe('JsonStore', () => {
  test('loads empty when file does not exist', () => {
    const file = tmpFile();
    const store = new JsonStore(file).load();
    expect(store.list()).toEqual([]);
    if (fs.existsSync(file)) fs.unlinkSync(file);
  });

  test('set and get a document', () => {
    const file = tmpFile();
    const store = new JsonStore(file).load();
    store.set('abc', { name: 'test', value: 42 });
    const doc = store.get('abc');
    expect(doc).toMatchObject({ id: 'abc', name: 'test', value: 42 });
    fs.unlinkSync(file);
  });

  test('list returns all documents', () => {
    const file = tmpFile();
    const store = new JsonStore(file).load();
    store.set('a', { name: 'alpha' });
    store.set('b', { name: 'beta' });
    const list = store.list();
    expect(list).toHaveLength(2);
    expect(list.map(d => d.name).sort()).toEqual(['alpha', 'beta']);
    fs.unlinkSync(file);
  });

  test('delete removes a document', () => {
    const file = tmpFile();
    const store = new JsonStore(file).load();
    store.set('x', { name: 'x' });
    expect(store.has('x')).toBe(true);
    const deleted = store.delete('x');
    expect(deleted).toBe(true);
    expect(store.get('x')).toBeNull();
    expect(store.has('x')).toBe(false);
    fs.unlinkSync(file);
  });

  test('delete returns false for non-existent id', () => {
    const file = tmpFile();
    const store = new JsonStore(file).load();
    expect(store.delete('nonexistent')).toBe(false);
    if (fs.existsSync(file)) fs.unlinkSync(file);
  });

  test('persists data across re-instantiation', () => {
    const file = tmpFile();
    const store1 = new JsonStore(file).load();
    store1.set('persist', { color: 'blue' });

    const store2 = new JsonStore(file).load();
    expect(store2.get('persist')).toMatchObject({ id: 'persist', color: 'blue' });
    fs.unlinkSync(file);
  });

  test('atomic write: tmp file is cleaned up', () => {
    const file = tmpFile();
    const store = new JsonStore(file).load();
    store.set('k', { v: 1 });
    // No .tmp files should remain
    const dir = path.dirname(file);
    const base = path.basename(file);
    const tmps = fs.readdirSync(dir).filter(f => f.startsWith(base + '.tmp.'));
    expect(tmps).toHaveLength(0);
    fs.unlinkSync(file);
  });

  test('toObject returns a copy of internal data', () => {
    const file = tmpFile();
    const store = new JsonStore(file).load();
    store.set('m', { x: 1 });
    const obj = store.toObject();
    expect(obj['m']).toMatchObject({ x: 1 });
    // Mutating toObject result should not affect store
    obj['m'].x = 999;
    expect(store.get('m').x).toBe(1);
    fs.unlinkSync(file);
  });
});
