import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DRAFT_OFFER_MAX_AGE_MS,
  TAB_STALE_MS,
  draftAutosaveKeys,
  findOrphanNewDraft,
  getDraftTabId,
  markTabAlive,
  type KeyValueStorage,
} from './draftAutosaveKeys';

function memoryStorage(): KeyValueStorage {
  const map = new Map<string, string>();
  return {
    get length() { return map.size; },
    key: (i) => [...map.keys()][i] ?? null,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => { map.set(k, v); },
    removeItem: (k) => { map.delete(k); },
  };
}

const NOW = 1_800_000_000_000;

function saveDraft(storage: KeyValueStorage, userId: string, tabId: string | null, timestamp: number, docId: string | null = null) {
  const suffix = tabId === null ? 'new' : `new_${tabId}`;
  storage.setItem(`draft_autosave_${userId}_${suffix}`, JSON.stringify({ docId, code: '기안', timestamp }));
  storage.setItem(`draft_autosave_active_${userId}_${suffix}`, 'true');
}

test('탭 ID 는 같은 탭(sessionStorage)에서 유지되고 탭마다 다르다', () => {
  const tabA = memoryStorage();
  const tabB = memoryStorage();
  const id = getDraftTabId(tabA);
  assert.equal(getDraftTabId(tabA), id);
  assert.notEqual(getDraftTabId(tabB), id);
  assert.match(id, /^[0-9a-f]+$/);
});

test('새 기안은 탭마다 다른 키, 문서 수정은 문서별 키', () => {
  assert.notEqual(draftAutosaveKeys('U1', null, 'aaa').draftKey, draftAutosaveKeys('U1', null, 'bbb').draftKey);
  assert.equal(draftAutosaveKeys('U1', 'DOC-1', 'aaa').draftKey, draftAutosaveKeys('U1', 'DOC-1', 'bbb').draftKey);
  assert.equal(draftAutosaveKeys('U1', null, 'aaa').activeKey.includes('active'), true);
  assert.equal(draftAutosaveKeys('U1', null, 'aaa').draftKey.includes('active'), false);
});

test('열려 있는 다른 탭의 보관본은 가져오지 않는다 — 백그라운드라 1분 넘게 갱신이 늦어도', () => {
  const storage = memoryStorage();
  saveDraft(storage, 'U1', 'aaa', NOW - 1000);
  markTabAlive(storage, 'aaa', NOW - 70_000);
  assert.equal(findOrphanNewDraft(storage, 'U1', 'bbb', NOW), null);
});

test('닫힌 탭의 보관본은 새 탭이 복구 제안한다 — 가장 최근 것', () => {
  const storage = memoryStorage();
  saveDraft(storage, 'U1', 'aaa', NOW - 60_000);
  saveDraft(storage, 'U1', 'ccc', NOW - 10_000);
  markTabAlive(storage, 'aaa', NOW - TAB_STALE_MS - 1);
  // ccc 는 생존 표시가 아예 없다(갑자기 꺼짐) → 닫힌 것으로 본다.
  const orphan = findOrphanNewDraft(storage, 'U1', 'bbb', NOW);
  assert.equal(orphan?.draftKey, 'draft_autosave_U1_new_ccc');
  assert.equal(orphan?.activeKey, 'draft_autosave_active_U1_new_ccc');
});

test('예전 공유 키(_new)의 보관본도 복구 대상이다', () => {
  const storage = memoryStorage();
  saveDraft(storage, 'U1', null, NOW - 1000);
  assert.equal(findOrphanNewDraft(storage, 'U1', 'bbb', NOW)?.draftKey, 'draft_autosave_U1_new');
});

test('이미 제안한 것·24시간 지난 것·다른 사용자·문서 수정본은 제외', () => {
  const storage = memoryStorage();
  saveDraft(storage, 'U1', 'old', NOW - DRAFT_OFFER_MAX_AGE_MS);
  saveDraft(storage, 'U2', 'other', NOW - 1000);
  saveDraft(storage, 'U1', 'offered', NOW - 1000);
  storage.removeItem('draft_autosave_active_U1_new_offered');
  storage.setItem('draft_autosave_U1_DOC-1', JSON.stringify({ docId: 'DOC-1', timestamp: NOW }));
  storage.setItem('draft_autosave_active_U1_DOC-1', 'true');
  assert.equal(findOrphanNewDraft(storage, 'U1', 'bbb', NOW), null);
});

test('자기 탭의 보관본은 고아로 보지 않는다', () => {
  const storage = memoryStorage();
  saveDraft(storage, 'U1', 'bbb', NOW - 1000);
  assert.equal(findOrphanNewDraft(storage, 'U1', 'bbb', NOW), null);
});
