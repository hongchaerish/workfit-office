import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { birthdayUserIds } from '@/domain/birthday/engine';
import { useEmployeeProfiles } from '@/features/employeeProfile/useEmployeeProfiles';
import { useUsers } from '@/features/user/useUsers';

/** 한국 시간 오늘(YYYY-MM-DD) */
const todayKst = () => new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);

const BirthdayContext = createContext<ReadonlySet<string>>(new Set());

/**
 * 오늘 생일인 사람 — 앱 전체에서 한 번만 계산한다(메신저·업무계획의 이름 옆 🎂).
 * 공개한 사람만, 음력은 올해 양력으로 환산(`birthdayUserIds`). 자정이 지나면 다시 계산한다.
 */
export function BirthdayProvider({ children }: { children: ReactNode }) {
  const profilesQuery = useEmployeeProfiles();
  const usersQuery = useUsers();
  const [today, setToday] = useState(todayKst);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const next = todayKst();
      setToday((current) => (current === next ? current : next));
    }, 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const ids = useMemo(() => {
    const active = new Set((usersQuery.data ?? []).filter((u) => u.status === '사용').map((u) => u.id));
    return birthdayUserIds(profilesQuery.data ?? [], active, today);
  }, [profilesQuery.data, usersQuery.data, today]);

  return <BirthdayContext.Provider value={ids}>{children}</BirthdayContext.Provider>;
}

export const useIsBirthday = (userId: string | null | undefined) => {
  const ids = useContext(BirthdayContext);
  return Boolean(userId && ids.has(userId));
};

/** 이름 바로 뒤에 붙이는 작은 🎂 — 오늘 생일이 아니면 아무것도 그리지 않는다. */
export function BirthdayMark({ userId, className = '' }: { userId: string | null | undefined; className?: string }) {
  if (!useIsBirthday(userId)) return null;
  return (
    <span role="img" aria-label="오늘 생일" title="오늘 생일" className={`ml-0.5 inline-block shrink-0 select-none text-[0.95em] leading-none ${className}`}>
      🎂
    </span>
  );
}
