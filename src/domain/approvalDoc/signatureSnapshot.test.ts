import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveSignatureSnapshot } from './signatureSnapshot.ts';

test('profile changes do not replace a saved stamp or signature', () => {
  const currentProfile = { signType: 'stamp', sealUrl: '/new-stamp.png', signUrl: '/new-signature.png' };
  assert.deepEqual(resolveSignatureSnapshot({ signType: 'stamp', sealUrl: '/old-stamp.png' }, currentProfile),
    { url: '/old-stamp.png', isSignature: false });
  assert.deepEqual(resolveSignatureSnapshot({ signType: 'signature', signUrl: '/old-signature.png' }, currentProfile),
    { url: '/old-signature.png', isSignature: true });
});

test('legacy saved images remain visible without a saved type', () => {
  assert.deepEqual(resolveSignatureSnapshot({ sealUrl: '/legacy-stamp.png' }),
    { url: '/legacy-stamp.png', isSignature: false });
  assert.deepEqual(resolveSignatureSnapshot({ signUrl: '/legacy-signature.png' }),
    { url: '/legacy-signature.png', isSignature: true });
});

test('a historical automatic stamp does not become a current registered image', () => {
  const currentProfile = { signType: 'stamp', sealUrl: '/new-stamp.png' };
  assert.deepEqual(resolveSignatureSnapshot({ signType: 'stamp', sealUrl: null }, currentProfile),
    { url: '', isSignature: false });
  assert.deepEqual(resolveSignatureSnapshot({ signType: 'signature', signUrl: '' }, currentProfile),
    { url: '', isSignature: true });
});

test('legacy documents without image data use the automatic stamp fallback', () => {
  assert.deepEqual(resolveSignatureSnapshot({}), { url: '', isSignature: false });
  assert.deepEqual(resolveSignatureSnapshot({ signType: null, sealUrl: null, signUrl: null }),
    { url: '', isSignature: false });
});

test('only an explicit draft fallback can use the current profile', () => {
  assert.deepEqual(resolveSignatureSnapshot({}, { signType: 'stamp', sealUrl: '/current-stamp.png' }),
    { url: '/current-stamp.png', isSignature: false });
  assert.deepEqual(resolveSignatureSnapshot({}, { signType: 'signature', signUrl: '/current-signature.png' }),
    { url: '/current-signature.png', isSignature: true });
});
