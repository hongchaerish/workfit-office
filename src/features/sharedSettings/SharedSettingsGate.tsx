import { useEffect, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { leaveAdjustmentStore } from '@/domain/leave/adjustmentStore';
import { substituteHolidayStore } from '@/domain/leave/substituteHolidayStore';
import { successionRepo } from '@/data/succession/succession.repo';
import { migrateLegacySharedSettings } from './migrateLegacySharedSettings';

/** 첫 로딩을 이보다 오래 막지 않는다 — DB가 느리거나 실패해도 화면은 뜨고, 다 읽히면 이벤트로 다시 그린다. */
const MAX_WAIT_MS = 5000;
const REFRESH_MS = 5 * 60 * 1000;

const hydrateAll = () =>
  Promise.allSettled([leaveAdjustmentStore.hydrate(), substituteHolidayStore.hydrate(), successionRepo.store.hydrate()]).then(
    (results) => {
      for (const r of results) if (r.status === 'rejected') console.warn('[sharedSettings] DB 조회 실패', r.reason);
    },
  );

/**
 * 전 임직원 공용 설정(연차 조정·대체휴무·결재 승계)을 DB에서 읽어 캐시를 채운 뒤 화면을 그린다.
 * 이 목록들은 여러 화면이 동기로 읽으므로, 비어 있는 채로 그려지면 결재함·잔여 연차가 잠깐 틀리게 계산된다.
 * 처음 한 번은 이 브라우저에 남은 옛 값(localStorage)을 DB로 옮기고, 이후 포커스·5분마다 다시 읽는다.
 */
export function SharedSettingsGate({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let alive = true;
    const timer = setTimeout(() => alive && setReady(true), MAX_WAIT_MS);

    void (async () => {
      try {
        const migrated = await migrateLegacySharedSettings();
        // 근태 대상·부재 설정은 react-query 캐시로 읽으므로 옮긴 값이 있으면 다시 읽힌다
        if (migrated > 0) void qc.invalidateQueries();
      } catch (e) {
        console.warn('[sharedSettings] 옛 브라우저 설정 이전 실패 — 다음 접속 때 다시 시도', e);
      }
      await hydrateAll();
      if (alive) setReady(true);
    })();

    const onFocus = () => void hydrateAll();
    window.addEventListener('focus', onFocus);
    const interval = setInterval(() => void hydrateAll(), REFRESH_MS);
    return () => {
      alive = false;
      clearTimeout(timer);
      clearInterval(interval);
      window.removeEventListener('focus', onFocus);
    };
  }, [qc]);

  return ready ? <>{children}</> : null;
}
