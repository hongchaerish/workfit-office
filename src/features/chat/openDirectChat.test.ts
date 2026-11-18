import assert from 'node:assert/strict';
import test from 'node:test';
import { openDirectChat, plainTextDoc } from './openDirectChat';
import { CHAT_DRAFT_FILL_EVENT } from './chatDrafts';

test('plainTextDoc: 한 문단, 줄바꿈은 hardBreak', () => {
  assert.deepEqual(plainTextDoc('가\n나'), {
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text: '가' }, { type: 'hardBreak' }, { type: 'text', text: '나' }] }],
  });
});

test('openDirectChat: 글이 있으면 이미 열린 입력창에도 채우라는 신호를 보낸다', async () => {
  const store = new Map<string, string>();
  const g = globalThis as Record<string, unknown>;
  g.localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };
  const target = new EventTarget();
  g.window = target;
  const fills: unknown[] = [];
  target.addEventListener(CHAT_DRAFT_FILL_EVENT, (e) => fills.push((e as CustomEvent).detail));
  const me = { id: 'u1', name: '나' } as never;
  const other = { id: 'u2', name: '너' } as never;
  await openDirectChat({ me, other, text: '안녕', createRoom: async () => ({ id: 'r1' }) });
  assert.deepEqual(fills, [{ me: 'u1', roomId: 'r1' }]);
  fills.length = 0;
  await openDirectChat({ me, other, createRoom: async () => ({ id: 'r1' }) });
  assert.deepEqual(fills, []);
});
