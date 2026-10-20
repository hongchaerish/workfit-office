import assert from 'node:assert/strict';
import test from 'node:test';
import { galleryFolderSchema, type GalleryFolder } from './schema';
import { buildFolderPath, collectFolderSubtree, folderDeletionOrder, planFolderRename } from './folderRules';

function folder(id: string, name: string, parentId: string | null, path: string): GalleryFolder {
  return galleryFolderSchema.parse({ id, name, parentId, path, createdAt: '2026-10-01' });
}

const folders = [
  folder('a', '행사', null, '/행사'),
  folder('b', '체육대회', 'a', '/행사/체육대회'),
  folder('c', '오전', 'b', '/옛이름/체육대회/오전'), // 이미 어긋난 경로
  folder('d', '워크숍', 'a', '/행사/워크숍'),
  folder('e', '일상', null, '/일상'),
];

test('경로는 상위 폴더 이름을 따라 만든다', () => {
  assert.equal(buildFolderPath(folders, 'c'), '/행사/체육대회/오전');
  assert.equal(buildFolderPath(folders, 'c', { id: 'a', name: '2026 행사' }), '/2026 행사/체육대회/오전');
});

test('이름 변경 시 자신과 하위 폴더 경로를 다시 계산한다', () => {
  const plan = planFolderRename(folders, 'a', '2026 행사', '');
  const byId = new Map(plan.map((f) => [f.id, f]));
  assert.deepEqual(plan.map((f) => f.id), ['a', 'b', 'c', 'd']);
  assert.equal(byId.get('a')?.name, '2026 행사');
  assert.equal(byId.get('a')?.path, '/2026 행사');
  assert.equal(byId.get('b')?.path, '/2026 행사/체육대회');
  assert.equal(byId.get('c')?.path, '/2026 행사/체육대회/오전');
  assert.equal(byId.get('d')?.name, '워크숍');
  assert.ok(!byId.has('e'));
});

test('이름이 같고 경로도 맞으면 하위 폴더는 다시 저장하지 않는다', () => {
  const plan = planFolderRename(folders, 'd', '워크숍', '설명');
  assert.deepEqual(plan.map((f) => f.id), ['d']);
  assert.equal(plan[0].description, '설명');
});

test('빈 설명으로 저장하면 설명이 지워진다', () => {
  const withDesc = [{ ...folders[4], description: '예전 설명' }];
  const plan = planFolderRename(withDesc, 'e', '일상', '');
  assert.equal(plan[0].description, '');
});

test('하위 폴더 수집과 삭제 순서', () => {
  assert.deepEqual(collectFolderSubtree(folders, 'a').map((f) => f.id), ['a', 'b', 'c', 'd']);
  assert.deepEqual(folderDeletionOrder(folders, 'a'), ['d', 'c', 'b', 'a']);
  assert.deepEqual(folderDeletionOrder(folders, 'e'), ['e']);
});

test('잘못된 순환 참조에도 멈춘다', () => {
  const loop = [folder('x', 'X', 'y', '/X'), folder('y', 'Y', 'x', '/Y')];
  assert.equal(buildFolderPath(loop, 'x'), '/Y/X');
  assert.equal(collectFolderSubtree(loop, 'x').length, 2);
});
