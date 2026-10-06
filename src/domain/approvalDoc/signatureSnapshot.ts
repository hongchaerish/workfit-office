export interface SignatureSnapshot {
  signType?: string | null;
  signUrl?: string | null;
  sealUrl?: string | null;
}

/** 저장된 이미지를 우선한다. 현재 프로필 대체는 작성 화면에서만 명시적으로 허용한다. */
export function resolveSignatureSnapshot(
  snapshot: SignatureSnapshot,
  currentProfile?: SignatureSnapshot,
): { url: string; isSignature: boolean } {
  if (snapshot.signType) {
    const isSignature = snapshot.signType === 'signature';
    return { url: (isSignature ? snapshot.signUrl : snapshot.sealUrl) ?? '', isSignature };
  }
  // 옛 문서에 유형이 없더라도 저장된 이미지 주소는 유지한다.
  if (snapshot.sealUrl) return { url: snapshot.sealUrl, isSignature: false };
  if (snapshot.signUrl) return { url: snapshot.signUrl, isSignature: true };
  if (currentProfile) return resolveSignatureSnapshot(currentProfile);
  // 당시 이미지 정보가 없는 문서는 현재 등록 이미지를 가져오지 않는다.
  return { url: '', isSignature: false };
}
