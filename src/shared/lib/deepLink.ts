import { useEffect, useRef } from 'react';

/**
 * 딥링크(주소 쿼리)를 지금 화면에 적용해야 하는지.
 * 같은 딥링크는 한 번만 적용한다 — 데이터 갱신마다 다시 적용하면 사용자가 옮겨 간
 * 선택·필터를 딥링크 대상으로 되돌려 버린다.
 */
export function shouldApplyDeepLink(lastAppliedKey: string | null, key: string | null, ready: boolean): boolean {
  if (!key || !ready) return false;
  return key !== lastAppliedKey;
}

/**
 * 딥링크를 키가 바뀔 때 한 번만 적용한다. 대상 데이터가 아직 없으면(`ready=false`) 준비될 때까지 미룬다.
 *
 * 결재 문서처럼 실시간으로 갱신되는 목록에 의존하는 effect 안에서 딥링크를 적용하면,
 * 다른 브라우저 탭이나 다른 직원의 결재로 목록이 바뀔 때마다 화면이 알림으로 들어온
 * 문서로 되돌아간다. 이 hook 으로 그 재적용을 막는다.
 */
export function useApplyDeepLinkOnce(key: string | null, ready: boolean, apply: () => void): void {
  const lastAppliedRef = useRef<string | null>(null);
  const applyRef = useRef(apply);
  applyRef.current = apply;

  useEffect(() => {
    if (!shouldApplyDeepLink(lastAppliedRef.current, key, ready)) return;
    lastAppliedRef.current = key;
    applyRef.current();
  }, [key, ready]);
}
