import assert from 'node:assert/strict';
import test from 'node:test';
import { DocumentExistsError, type InsertableCrudBackend } from './crudBackend';
import { createSharedListStore, migrateLegacyItems } from './sharedListStore';

interface Row {
  id: string;
  v: number;
}

function memBackend(initial: Row[] = []): InsertableCrudBackend<Row> & { rows: Row[] } {
  const b = {
    rows: initial.slice(),
    async loadAll() {
      return b.rows.slice();
    },
    async loadWithQueries() {
      return b.rows.slice();
    },
    async save(item: Row) {
      b.rows = [...b.rows.filter((r) => r.id !== item.id), item];
    },
    async insert(item: Row) {
      if (b.rows.some((r) => r.id === item.id)) throw new DocumentExistsError('t', item.id);
      b.rows = [...b.rows, item];
    },
    async remove(id: string) {
      b.rows = b.rows.filter((r) => r.id !== id);
    },
  };
  return b;
}

test('hydrate 전에는 비어 있고, hydrate 후 DB 목록을 동기로 돌려준다', async () => {
  const store = createSharedListStore<Row>({ backend: memBackend([{ id: 'a', v: 1 }]), idOf: (r) => r.id });
  assert.deepEqual(store.getAll(), []);
  await store.hydrate();
  assert.deepEqual(store.getAll(), [{ id: 'a', v: 1 }]);
});

test('save·remove 는 DB에 반영된 뒤 캐시에 반영된다', async () => {
  const backend = memBackend();
  const store = createSharedListStore<Row>({ backend, idOf: (r) => r.id });
  await store.save({ id: 'a', v: 1 });
  await store.save({ id: 'a', v: 2 });
  assert.deepEqual(backend.rows, [{ id: 'a', v: 2 }]);
  assert.deepEqual(store.getAll(), [{ id: 'a', v: 2 }]);
  await store.remove('a');
  assert.deepEqual(backend.rows, []);
  assert.deepEqual(store.getAll(), []);
});

test('DB 저장이 실패하면 캐시는 바뀌지 않고 오류가 전달된다', async () => {
  const backend = memBackend();
  backend.save = async () => {
    throw new Error('offline');
  };
  const store = createSharedListStore<Row>({ backend, idOf: (r) => r.id });
  await assert.rejects(store.save({ id: 'a', v: 1 }), /offline/);
  assert.deepEqual(store.getAll(), []);
});

test('옛 브라우저 데이터 이전 — 없는 것만 넣고 이미 있는 문서는 덮어쓰지 않는다', async () => {
  const backend = memBackend([{ id: 'a', v: 100 }]);
  const n = await migrateLegacyItems(backend, [
    { id: 'a', v: 1 },
    { id: 'b', v: 2 },
  ]);
  assert.equal(n, 1);
  assert.deepEqual(backend.rows, [
    { id: 'a', v: 100 },
    { id: 'b', v: 2 },
  ]);
});
