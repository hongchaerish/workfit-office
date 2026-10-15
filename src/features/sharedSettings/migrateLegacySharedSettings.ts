import { migrateLegacyItems, migrateLegacyKey } from '@/data/_backend/sharedListStore';
import {
  LEGACY_ADJUSTMENT_STORAGE_KEY,
  leaveAdjustmentBackend,
  parseAdjustment,
} from '@/domain/leave/adjustmentStore';
import {
  LEGACY_SUBSTITUTE_HOLIDAY_STORAGE_KEY,
  parseSubstituteHolidayGrant,
  substituteHolidayBackend,
} from '@/domain/leave/substituteHolidayStore';
import { LEGACY_ABSENCE_STORAGE_PREFIX, absenceBackend, parseAbsence } from '@/data/absence/absence.repo';
import { LEGACY_ATTENDANCE_TARGET_STORAGE_KEY, attendanceTargetBackend } from '@/data/employeeProfile/employeeProfile.repo';

const parseArray = <T>(raw: string, parse: (x: unknown) => T | null): T[] => {
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.map(parse).filter((x): x is T => x !== null) : [];
  } catch {
    return [];
  }
};

let running: Promise<number> | null = null;

/**
 * 전사 설정이 브라우저(localStorage)에만 있던 시절의 값을 DB로 한 번 옮긴다.
 * 같은 ID 문서가 DB에 이미 있으면 건너뛰고(덮어쓰지 않음), 옮긴 키는 `<키>.migrated` 로 보관한다.
 * @returns 새로 넣은 문서 수
 */
export function migrateLegacySharedSettings(): Promise<number> {
  running ??= run().finally(() => {
    running = null;
  });
  return running;
}

async function run(): Promise<number> {
  if (typeof localStorage === 'undefined') return 0;
  let total = 0;

  total += await migrateLegacyKey(LEGACY_ADJUSTMENT_STORAGE_KEY, (raw) =>
    migrateLegacyItems(leaveAdjustmentBackend, parseArray(raw, parseAdjustment)),
  );
  total += await migrateLegacyKey(LEGACY_SUBSTITUTE_HOLIDAY_STORAGE_KEY, (raw) =>
    migrateLegacyItems(substituteHolidayBackend, parseArray(raw, parseSubstituteHolidayGrant)),
  );
  total += await migrateLegacyKey(LEGACY_ATTENDANCE_TARGET_STORAGE_KEY, (raw) => {
    let map: Record<string, unknown> = {};
    try {
      map = JSON.parse(raw) ?? {};
    } catch {
      /* 깨진 값은 옮길 것이 없다 */
    }
    const rows = Object.entries(map)
      .filter(([k, v]) => k && typeof v === 'boolean')
      .map(([targetKey, isTarget]) => ({ targetKey, isTarget: isTarget as boolean, updatedAt: null }));
    return migrateLegacyItems(attendanceTargetBackend, rows);
  });

  const absenceKeys: string[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(LEGACY_ABSENCE_STORAGE_PREFIX) && !k.endsWith('.migrated')) absenceKeys.push(k);
    }
  } catch {
    /* 저장소 접근 불가 */
  }
  for (const key of absenceKeys) {
    total += await migrateLegacyKey(key, (raw) => {
      let cfg = null;
      try {
        cfg = parseAbsence(JSON.parse(raw));
      } catch {
        /* 깨진 값은 옮길 것이 없다 */
      }
      return cfg ? migrateLegacyItems(absenceBackend, [cfg]) : Promise.resolve(0);
    });
  }

  return total;
}
