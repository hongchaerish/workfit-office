import assert from 'node:assert/strict';
import test from 'node:test';
import { plainTextDoc } from './openDirectChat';

test('plainTextDoc: 한 문단, 줄바꿈은 hardBreak', () => {
  assert.deepEqual(plainTextDoc('가\n나'), {
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text: '가' }, { type: 'hardBreak' }, { type: 'text', text: '나' }] }],
  });
});
