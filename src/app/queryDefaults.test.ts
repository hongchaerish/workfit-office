import assert from 'node:assert/strict';
import test from 'node:test';
import { QueryClient } from '@tanstack/react-query';
import { applyQueryDefaults, MASTER_STALE_MS } from './queryDefaults';

test('조직·기준 정보는 5분 동안 다시 받지 않는다', () => {
  const qc = new QueryClient();
  applyQueryDefaults(qc);
  for (const key of [['users', null], ['departments', null], ['employeeProfiles'], ['positions', null], ['jobTitles', null], ['departmentMembers'], ['roleGroups'], ['holidays', 2026], ['commonCodes', 'X']]) {
    assert.equal(qc.getQueryDefaults(key).staleTime, MASTER_STALE_MS, JSON.stringify(key));
  }
  assert.equal(MASTER_STALE_MS, 5 * 60_000);
});

test('그 밖의 데이터(메신저·결재 등)는 기본값 그대로', () => {
  const qc = new QueryClient();
  applyQueryDefaults(qc);
  assert.equal(qc.getQueryDefaults(['chatRooms']).staleTime, undefined);
  assert.equal(qc.getQueryDefaults(['approvalDocs']).staleTime, undefined);
});
