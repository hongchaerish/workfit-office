import assert from 'node:assert/strict';
import test from 'node:test';
import { isEditableStatus } from './engine';

test('임시저장·반려·회수·시행반송 문서는 그 문서 그대로 고쳐 (재)상신한다', () => {
  for (const status of ['임시저장', '반려', '긴급 조치 사후 검토 반려', '회수', '시행반송']) {
    assert.equal(isEditableStatus(status), true, status);
  }
});

test('진행중·완료 문서는 고칠 수 없다', () => {
  for (const status of ['진행중', '완료', '시행대기', '취소완료', '삭제']) {
    assert.equal(isEditableStatus(status), false, status);
  }
});
