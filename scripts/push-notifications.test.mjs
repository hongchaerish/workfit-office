import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

function serverFixture() {
  const sent = [];
  const context = vm.createContext({
    admin: { apps: [{}], messaging: () => ({
      sendEachForMulticast: async (payload) => {
        sent.push(payload);
        return { successCount: payload.tokens.length };
      },
    }) },
  });
  const source = read('appwrite/functions/push-notifications/src/main.js')
    .replace(/^import .*;\r?\n/gm, '')
    .replace('export default async', 'const entry = async');
  vm.runInContext(`${source}\nglobalThis.handleChat = handleChatMessage; globalThis.preview = chatPreview;`, context);
  return { sent, context, db: {
    // Only read APIs are provided: a write during chat dispatch would fail the test.
    getDocument: async (_database, collection, id) => collection === 'chatRooms'
      ? { name: '팀 채팅', members: ['sender', 'receiver', 'no-token'] }
      : { fcmToken: id === 'receiver' ? 'receiver-token' : '' },
  } };
}

test('채팅 발송: 발신자 제외, 이름·미리보기 전달, 기존 모바일 payload와 클릭 경로 유지', async () => {
  const { context, db, sent } = serverFixture();
  await context.handleChat({ roomId: 'ROOM', senderId: 'sender', senderName: '홍길동', text: '회의\n  시작합니다', type: 'text' }, db, 'test', () => {});
  assert.equal(sent.length, 1);
  const payload = sent[0];
  assert.deepEqual(Array.from(payload.tokens), ['receiver-token']);
  assert.equal(payload.data.roomId, 'ROOM');
  assert.equal(payload.data.title, '홍길동 · 팀 채팅');
  assert.equal(payload.data.body, '회의 시작합니다');
  assert.equal(payload.android.notification.body, payload.data.body);
  assert.equal(payload.apns.payload.aps.alert.title, payload.data.title);
});

test('미리보기: 긴 내용·이모지·빈 메시지·첨부를 처리하고 시스템 메시지는 발송하지 않음', async () => {
  const { context, db, sent } = serverFixture();
  assert.equal(context.preview({ text: '😀'.repeat(81) }), '😀'.repeat(80) + '…');
  assert.equal(context.preview({ text: '  ' }), '새로운 메시지가 도착했습니다.');
  assert.equal(context.preview({ type: 'image', text: 'internal-image-url' }), '사진을 보냈습니다.');
  assert.equal(context.preview({ type: 'file', text: 'internal-file-url' }), '파일을 보냈습니다.');
  const result = await context.handleChat({ type: 'system' }, db, 'test', () => {});
  assert.equal(result.skipped, 'system');
  assert.equal(sent.length, 0);
});

function foregroundFixture(permission = 'granted', mobile = false, screen = 'desktop') {
  const source = read(screen === 'mobile' ? 'src/mobile/MobileApp.tsx' : 'src/app/App.tsx');
  const ast = ts.createSourceFile('App.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let effect;
  const walk = (node) => {
    if (ts.isCallExpression(node) && node.expression.getText(ast) === 'useEffect'
      && node.arguments[0]?.getText(ast).includes('void onForegroundMessage')) effect = node.arguments[0].getText(ast);
    ts.forEachChild(node, walk);
  };
  walk(ast);
  assert.ok(effect);
  const shown = [], callbacks = [], warnings = [], timers = [], messages = [];
  const page = { visibilityState: 'visible', focused: true, hasFocus() { return this.focused; } };
  const registration = {
    active: { postMessage: (message) => messages.push(message) },
    showNotification: async (title, options) => shown.push({ title, options, data: options.data, tag: options.tag, closed: false, close() { this.closed = true; } }),
    getNotifications: async ({ tag }) => shown.filter((item) => item.tag === tag && !item.closed).slice(-1),
  };
  const context = vm.createContext({
    user: { id: 'receiver' }, isMobilePwa: mobile,
    document: page,
    Notification: { permission },
    navigator: { serviceWorker: { getRegistration: async () => registration } },
    setTimeout: (fn, ms) => timers.push({ fn, ms }),
    onForegroundMessage: async (callback) => { callbacks.push(callback); },
    console: { warn: (...args) => warnings.push(args) },
  });
  vm.runInContext(ts.transpileModule(read('src/shared/lib/viewedChatRoom.ts').replace(/^export /gm, ''), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  vm.runInContext(ts.transpileModule(read('src/shared/lib/transientPushNotification.ts').replace(/^export /gm, ''), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  vm.runInContext(ts.transpileModule(`(${effect})();`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  return { shown, callbacks, warnings, timers, messages, page, context, registerRoom: context.registerViewedChatRoom };
}

test('PC·모바일: 현재 보는 방만 생략하고 다른 방·결재·일정 알림은 유지', async () => {
  for (const screen of ['desktop', 'mobile']) {
    const { registerRoom, callbacks, shown } = foregroundFixture('granted', false, screen);
    const leave = registerRoom('ROOM');
    await callbacks[0]({ roomId: 'ROOM', title: '현재 방', body: '내용' });
    assert.equal(shown.length, 0, screen);
    await callbacks[0]({ roomId: 'OTHER', title: '다른 방', body: '내용' });
    await callbacks[0]({ docId: 'DOC', title: '결재', body: '내용' });
    await callbacks[0]({ linkUrl: '/gw/calendar', title: '일정', body: '내용' });
    assert.equal(shown.length, 3, screen);
    leave();
    await callbacks[0]({ roomId: 'ROOM', title: '나간 방', body: '내용' });
    assert.equal(shown.length, 4, screen);
  }
});

test('PC·모바일: 최소화·포커스 이탈 시 다시 표시하고 복귀하면 생략', async () => {
  for (const screen of ['desktop', 'mobile']) {
    const { registerRoom, callbacks, shown, page } = foregroundFixture('granted', false, screen);
    const leave = registerRoom('ROOM');
    const payload = { roomId: 'ROOM', title: '채팅', body: '내용' };
    page.visibilityState = 'hidden';
    await callbacks[0](payload);
    page.visibilityState = 'visible';
    page.focused = false;
    await callbacks[0](payload);
    assert.equal(shown.length, 2, screen);
    page.focused = true;
    await callbacks[0](payload);
    assert.equal(shown.length, 2, screen);
    leave();
  }
});

test('패널 교체·중복 화면 정리가 다른 활성 채팅방 상태를 지우지 않음', async () => {
  const { registerRoom, callbacks, shown } = foregroundFixture();
  const leaveFirst = registerRoom('ROOM');
  const leaveSecond = registerRoom('ROOM');
  leaveFirst();
  await callbacks[0]({ roomId: 'ROOM', title: '현재 방' });
  assert.equal(shown.length, 0);
  leaveSecond();
  const leaveOther = registerRoom('OTHER');
  await callbacks[0]({ roomId: 'ROOM', title: '이전 방' });
  assert.equal(shown.length, 1);
  await callbacks[0]({ roomId: 'OTHER', title: '새 방' });
  assert.equal(shown.length, 1);
  leaveOther();
});

test('화면 연결: 목록·새 대화·알림 기록에서는 등록하지 않고 PC·모바일 퇴장 시 해제', () => {
  for (const [file, states] of [
    ['src/features/chat/desktop/MessengerPanel.tsx', [
      { isVisible: true, composing: false, openRoom: { id: 'ROOM' }, expected: true },
      { isVisible: false, composing: false, openRoom: { id: 'ROOM' }, expected: false },
      { isVisible: true, composing: true, openRoom: { id: 'ROOM' }, expected: false },
      { isVisible: true, composing: false, openRoom: null, expected: false },
    ]],
    ['src/mobile/MobileChatThread.tsx', [
      { room: { id: 'ROOM' }, expected: true }, { room: undefined, expected: false },
    ]],
  ]) {
    const ast = ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    let effect;
    const walk = node => {
      if (ts.isCallExpression(node) && node.expression.getText(ast) === 'useLayoutEffect'
        && node.arguments[0]?.getText(ast).includes('registerViewedChatRoom')) effect = node.arguments[0].getText(ast);
      ts.forEachChild(node, walk);
    };
    walk(ast);
    assert.ok(effect, file);
    for (const state of states) {
      const { context } = foregroundFixture();
      Object.assign(context, state);
      const cleanup = vm.runInContext(ts.transpileModule(`(${effect})();`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
      assert.equal(context.shouldSuppressChatPopup('ROOM'), state.expected, file);
      cleanup?.();
      assert.equal(context.shouldSuppressChatPopup('ROOM'), false, file);
    }
  }
});

test('PC 활성 상태: 같은 방의 반복 메시지에도 renotify, 발신자·미리보기·클릭 데이터 유지', async () => {
  const { callbacks, shown } = foregroundFixture();
  for (const body of ['첫 메시지', '다음 메시지']) {
    await callbacks[0]({ title: '홍길동 · 팀 채팅', body, roomId: 'ROOM' });
  }
  assert.equal(shown.length, 2);
  assert.equal(shown[0].title, '홍길동 · 팀 채팅');
  assert.equal(shown[1].options.body, '다음 메시지');
  for (const notification of shown) {
    assert.equal(notification.options.renotify, true);
    assert.equal(notification.options.tag, 'ROOM');
    assert.equal(notification.options.data.roomId, 'ROOM');
  }
});

test('PC 활성 상태: 권한 차단·모바일 제외를 유지하고 일정 알림은 기존 본문과 링크 유지', async () => {
  const denied = foregroundFixture('denied');
  await denied.callbacks[0]({ title: '메시지', body: '내용', roomId: 'ROOM' });
  assert.equal(denied.shown.length, 0);
  assert.equal(foregroundFixture('granted', true).callbacks.length, 0);
  const calendar = foregroundFixture();
  await calendar.callbacks[0]({ title: '일정', body: '일정 안내', linkUrl: '/gw/calendar?date=2026-10-07' });
  assert.equal(calendar.shown[0].options.body, '일정 안내');
  assert.equal(calendar.shown[0].options.renotify, false);
  assert.equal(calendar.shown[0].options.data.linkUrl, '/gw/calendar?date=2026-10-07');
});

function backgroundFixture() {
  let callback;
  const shown = [], timers = [], listeners = {};
  const context = vm.createContext({
    setTimeout: (fn, ms) => timers.push({ fn, ms }),
    importScripts: () => {},
    firebase: { initializeApp: () => {}, messaging: () => ({ onBackgroundMessage: (cb) => { callback = cb; } }) },
    self: {
      addEventListener: (name, listener) => { listeners[name] = listener; },
      registration: {
        showNotification: async (title, options) => shown.push({ title, options, data: options.data, tag: options.tag, closed: false, close() { this.closed = true; } }),
        getNotifications: async ({ tag }) => shown.filter((item) => item.tag === tag && !item.closed).slice(-1),
      },
    },
  });
  vm.runInContext(read('public/firebase-messaging-sw.js'), context);
  return { callback, shown, timers, listeners };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

test('백그라운드 서비스워커: 미리보기와 클릭 데이터를 유지하고 10초 뒤 닫음', async () => {
  const { callback, shown, timers } = backgroundFixture();
  const pending = callback({ data: { title: '홍길동 · 팀 채팅', body: '회의 시작합니다', roomId: 'ROOM' } });
  await flush();
  assert.equal(shown[0].title, '홍길동 · 팀 채팅');
  assert.equal(shown[0].options.body, '회의 시작합니다');
  assert.equal(shown[0].options.renotify, true);
  assert.equal(shown[0].options.data.roomId, 'ROOM');
  assert.equal(shown[0].options.requireInteraction, false);
  assert.equal(timers[0].ms, 10_000);
  assert.equal(shown[0].closed, false);
  timers[0].fn();
  await pending;
  assert.equal(shown[0].closed, true);
});

test('포그라운드: 10초 타이머가 같은 방의 새 알림을 닫지 않음', async () => {
  const { callbacks, shown, timers, messages } = foregroundFixture();
  await callbacks[0]({ title: '팀 채팅', body: '첫 메시지', roomId: 'ROOM' });
  await callbacks[0]({ title: '팀 채팅', body: '새 메시지', roomId: 'ROOM' });
  assert.equal(timers[0].ms, 10_000);
  assert.equal(messages[0].type, 'workfit-expire-notification');
  assert.equal(shown[0].options.requireInteraction, false);
  timers[0].fn();
  await flush();
  assert.equal(shown[1].closed, false);
  timers[1].fn();
  await flush();
  assert.equal(shown[1].closed, true);
});

test('백그라운드: 이전 타이머는 새 알림을 유지하고 SW 메시지도 만료까지 기다림', async () => {
  const { callback, shown, timers, listeners } = backgroundFixture();
  const first = callback({ data: { roomId: 'ROOM', body: '첫 메시지' } });
  await flush();
  const second = callback({ data: { roomId: 'ROOM', body: '새 메시지' } });
  await flush();
  timers[0].fn();
  await first;
  assert.equal(shown[1].closed, false);
  let expiry;
  listeners.message({ data: { type: 'workfit-expire-notification', id: shown[1].data.workfitNotificationId, tag: 'ROOM' }, waitUntil: (promise) => { expiry = promise; } });
  assert.equal(timers[2].ms, 10_000);
  timers[2].fn();
  await expiry;
  assert.equal(shown[1].closed, true);
  timers[1].fn();
  await second;
});
