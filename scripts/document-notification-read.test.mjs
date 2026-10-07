import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const read = file => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const compile = source => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
function fixture() {
  const context = vm.createContext({ URL });
  vm.runInContext(compile(read('src/data/notification/approvalNotificationRead.ts').replace(/^import type .*;\r?\n/gm, '').replace(/^export /gm, '')), context);
  return context;
}
const at = Date.parse('2026-10-07T10:00:00.500+09:00');
const notification = (changes = {}) => ({ id: 'N1', userId: 'ME', type: '결재', read: false, linkUrl: '/gw/approval?doc=DOC', createdAt: '2026-10-07T09:59:59+09:00', ...changes });

test('정확한 문서·사용자·결재 알림만 처리하며 읽은 것·새 알림·불량 시각은 제외', () => {
  const { isOpenedDocumentNotification: matches } = fixture();
  assert.equal(matches(notification(), 'ME', 'DOC', at), true);
  assert.equal(matches(notification({ linkUrl: '/m/approval/DOC' }), 'ME', 'DOC', at), true);
  for (const changes of [
    { userId: 'OTHER' }, { type: '일정' }, { read: true }, { linkUrl: '/gw/approval?doc=DOC2' },
    { linkUrl: '/gw/calendar?doc=DOC' }, { linkUrl: null }, { createdAt: 'bad' },
    { createdAt: '2026-10-07T10:00:00+09:00' }, { createdAt: '2026-10-07T10:00:01+09:00' },
  ]) assert.equal(matches(notification(changes), 'ME', 'DOC', at), false, JSON.stringify(changes));
  assert.equal(matches(notification({ createdAt: '2026-10-07T00:59:59.999Z' }), 'ME', 'DOC', at), true);
});

test('한 건 저장 실패에도 다른 대상은 계속 처리하고 대상 외 알림은 변경하지 않음', async () => {
  const { markOpenedDocumentNotifications: mark } = fixture();
  const written = [];
  const backend = {
    listUnreadApprovals: async () => [notification(), notification({ id: 'N2' }), notification({ id: 'N3', userId: 'OTHER' })],
    markAsRead: async id => { written.push(id); if (id === 'N1') throw Error('offline'); },
  };
  await assert.rejects(mark(backend, 'ME', 'DOC', at), /일부 실패/);
  assert.deepEqual(written, ['N1', 'N2']);
});

test('모바일 연결: 미로드·권한 거부는 제외하고 원본 화면은 공용 뷰에서 처리', () => {
  const source = read('src/mobile/MobileApprovalDetail.tsx');
  const ast = ts.createSourceFile('mobile.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let call;
  const walk = node => {
    if (ts.isCallExpression(node) && node.expression.getText(ast) === 'useDocumentNotificationRead') call = node.getText(ast);
    ts.forEachChild(node, walk);
  };
  walk(ast);
  for (const [viewMode, canAccessDocument, doc, expected] of [
    ['compact', true, undefined, undefined], ['compact', false, { id: 'DOC' }, undefined],
    ['original', true, { id: 'DOC' }, undefined], ['compact', true, { id: 'DOC' }, 'DOC'],
  ]) {
    let passed;
    const context = vm.createContext({ me: 'ME', viewMode, canAccessDocument, doc, useDocumentNotificationRead: (userId, docId) => { passed = { userId, docId }; } });
    vm.runInContext(compile(call), context);
    assert.deepEqual(passed, { userId: 'ME', docId: expected });
  }
});

test('조회 중 화면·계정이 바뀌면 늦은 응답으로 읽음 처리하지 않음', async () => {
  const { markOpenedDocumentNotifications: mark } = fixture();
  let current = true, resolve;
  const written = [];
  const pending = mark({ listUnreadApprovals: () => new Promise(r => { resolve = r; }), markAsRead: async id => written.push(id) }, 'ME', 'DOC', at, () => current);
  current = false;
  resolve([notification()]);
  await pending;
  assert.deepEqual(written, []);
});

test('Appwrite: 100건 이후도 조회하며 기존 사용자·읽음 인덱스를 사용하고 조회 중 쓰지 않음', async () => {
  const source = read('src/data/notification/notification.repo.ts');
  const ast = ts.createSourceFile('repo.ts', source, ts.ScriptTarget.Latest, true);
  const klass = ast.statements.find(node => ts.isClassDeclaration(node) && node.name.text === 'AppwriteBackend');
  const calls = [];
  const documents = Array.from({ length: 210 }, (_, i) => ({ ...notification({ id: `N${i}` }), $id: `N${i}` }));
  const context = vm.createContext({
    APPWRITE_DATABASE_ID: 'test', COLL: 'notifications',
    Query: Object.fromEntries(['equal', 'limit', 'cursorAfter'].map(name => [name, (...args) => ({ name, args })])),
    databases: { listDocuments: async (_db, collection, queries) => {
      assert.equal(collection, 'notifications');
      calls.push(queries);
      const after = queries.find(q => q.name === 'cursorAfter')?.args[0];
      const start = after ? documents.findIndex(d => d.$id === after) + 1 : 0;
      return { documents: documents.slice(start, start + 100) };
    } },
    safeParseNoti: row => row, notNull: n => n !== null,
  });
  vm.runInContext(compile(`${klass.getText(ast)}\nglobalThis.backend = new AppwriteBackend();`), context);
  const result = await context.backend.listUnreadApprovals('ME');
  assert.equal(result.length, 210);
  assert.equal(calls.length, 3);
  for (const queries of calls) {
    const filters = Array.from(queries).filter(q => q.name === 'equal').map(q => Array.from(q.args));
    assert.deepEqual(filters, [['userId', 'ME'], ['read', false]]);
  }
});

test('PC 연결: 미리보기·권한 거부에서는 읽지 않고 실제 본문에만 연결', () => {
  const source = read('src/modules/gw/approval/ApprovalDocumentView.tsx');
  const ast = ts.createSourceFile('view.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let call;
  const walk = node => {
    if (ts.isCallExpression(node) && node.expression.getText(ast) === 'useDocumentNotificationRead') call = node.getText(ast);
    ts.forEachChild(node, walk);
  };
  walk(ast);
  for (const [isPreview, canAccessDocument, expected] of [[true, true, undefined], [false, false, undefined], [false, true, 'DOC']]) {
    let passed;
    const context = vm.createContext({ currentUser: { id: 'ME' }, doc: { id: 'DOC' }, isPreview, canAccessDocument, useDocumentNotificationRead: (userId, docId) => { passed = { userId, docId }; } });
    vm.runInContext(compile(call), context);
    assert.deepEqual(passed, { userId: 'ME', docId: expected });
  }
});
