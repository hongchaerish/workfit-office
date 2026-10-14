import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import { createMemoryStore } from './memoryStore';
import { dispatch } from './dispatch';
import { directory, user } from './testkit';

const SECRET = 'test-secret';
const mint = (uid: string, ttl = 3600) => {
  const p = Buffer.from(JSON.stringify({ uid, exp: Math.floor(Date.now() / 1000) + ttl })).toString('base64url');
  return `${p}.${crypto.createHmac('sha256', SECRET).update(p).digest('hex')}`;
};
const deps = (users = [user('U1'), user('U9', '개발팀', '잠금')]) => ({
  store: createMemoryStore(),
  directory: directory(users),
  secret: SECRET,
  newId: () => crypto.randomUUID(),
});

test('토큰이 없거나 위조·만료면 401', async () => {
  assert.equal((await dispatch({ action: 'listMine', payload: {} }, deps())).status, 401);
  const forged = mint('U1').replace(/.$/, (c) => (c === 'a' ? 'b' : 'a'));
  assert.equal((await dispatch({ token: forged, action: 'listMine', payload: {} }, deps())).status, 401);
  assert.equal((await dispatch({ token: mint('U1', -10), action: 'listMine', payload: {} }, deps())).status, 401);
});

test('잠금 계정은 403', async () => {
  assert.equal((await dispatch({ token: mint('U9'), action: 'listMine', payload: {} }, deps())).status, 403);
});

test('알 수 없는 action 은 400', async () => {
  const res = await dispatch({ token: mint('U1'), action: 'nope', payload: {} }, deps());
  assert.equal(res.status, 400);
});

test('정상 요청은 { data } — 본문의 userId 는 무시한다', async () => {
  const created = await dispatch({
    token: mint('U1'),
    action: 'createDraft',
    payload: {
      draft: {
        title: 't', description: '', categoryCode: 'EMPLOYEE', audienceType: 'COMPANY', audienceDeptIds: [], audienceUserIds: [],
        anonymous: true, startsAt: null, endsAt: null, showResultToRespondent: false,
      },
      userId: 'U9',
    },
  }, deps());
  assert.equal(created.status, 200);
  assert.equal((created.body as { data: { ownerUserId: string } }).data.ownerUserId, 'U1');
});

test('SurveyError 는 400 + 코드로', async () => {
  const res = await dispatch({ token: mint('U1'), action: 'getSurvey', payload: { id: 'SUR-없음' } }, deps());
  assert.equal(res.status, 400);
  assert.equal((res.body as { error: { code: string } }).error.code, 'INVALID_INPUT');
});
