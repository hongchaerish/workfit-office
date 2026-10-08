import assert from 'node:assert/strict';
import test from 'node:test';
import { createCrudBackend, DocumentExistsError } from './crudBackend';

test('insert 는 같은 ID 문서를 덮어쓰지 않고 DocumentExistsError 를 던진다', async () => {
  const backend = createCrudBackend<{ id: string; v: number }>({
    coll: 'insertTest',
    parse: (raw) => raw as { id: string; v: number },
    idOf: (row) => row.id,
    seed: [],
  });
  await backend.insert({ id: 'A', v: 1 });
  await assert.rejects(() => backend.insert({ id: 'A', v: 2 }), (error) => error instanceof DocumentExistsError);
  assert.deepEqual(await backend.loadAll(), [{ id: 'A', v: 1 }]);
});
