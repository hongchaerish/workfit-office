import { z } from 'zod';
import { employeeProfileSchema, type EmployeeProfile } from '@/domain/employeeProfile/schema';
import { createCrudBackend } from '@/data/_backend/crudBackend';
import { hideTestAccountRows } from '@/data/_backend/testAccountVisibility';
import { isTestAccount } from '@/domain/user/testAccount';

/** 예전 브라우저 저장 키 — DB 이전([[migrateLegacySharedSettings]]) 때만 읽는다. */
export const LEGACY_ATTENDANCE_TARGET_STORAGE_KEY = 'workfit-attendance-target-overrides';

/**
 * 근태 대상 여부 — 전 임직원 공용 설정이라 독립 컬렉션(attendanceTargets)에 둔다.
 * employeeProfiles 원본은 건드리지 않고, 읽을 때 targetKey(프로필 id → userId → 사번 순)로 덧씌운다.
 */
export interface AttendanceTarget {
  targetKey: string;
  isTarget: boolean;
  updatedAt?: string | null;
}

const attendanceTargetSchema = z.object({
  targetKey: z.string().min(1),
  isTarget: z.boolean().nullish().transform((v) => v ?? true),
  updatedAt: z.string().nullish(),
});

export const attendanceTargetBackend = createCrudBackend<AttendanceTarget>({
  coll: 'attendanceTargets',
  parse: (raw) => {
    const p = attendanceTargetSchema.safeParse(raw);
    return p.success ? p.data : null;
  },
  idOf: (x) => x.targetKey,
  seed: [],
});

async function loadAttendanceOverrides(): Promise<Record<string, boolean>> {
  const rows = await attendanceTargetBackend.loadAll();
  return Object.fromEntries(rows.map((r) => [r.targetKey, r.isTarget]));
}

/**
 * 임직원 인사 프로필 Repository — employeeProfiles 컬렉션 캡슐화.
 */
const backend = createCrudBackend<EmployeeProfile>({
  coll: 'employeeProfiles',
  parse: (raw) => {
    const p = employeeProfileSchema.safeParse(raw);
    if (!p.success) {
      console.error('Failed to parse employeeProfile:', p.error);
      return null;
    }
    return p.data;
  },
  idOf: (x) => x.id,
  seed: [],
  stripFields: ['isAttendanceTarget'],
});

export const employeeProfileRepo = {
  /** 임직원 인사 프로필 목록 — 접속자가 볼 수 없는 테스트 계정 프로필은 빠진다([[testAccountVisibility]]). */
  async list(): Promise<EmployeeProfile[]> {
    const all = await this.listIncludingTestAccounts();
    return hideTestAccountRows(
      all,
      (p) => [p.userId, p.id],
      (p) => isTestAccount({ id: p.userId, name: p.name, dept: p.dept }),
    );
  },

  /** 테스트 계정 프로필까지 포함한 전체 목록 — 사용자 조인·저장 경로 전용. */
  async listIncludingTestAccounts(): Promise<EmployeeProfile[]> {
    const [items, overrides] = await Promise.all([backend.loadAll(), loadAttendanceOverrides()]);
    return items.map((item) => {
      const override = overrides[item.id] ?? overrides[item.userId] ?? overrides[item.empNo];
      if (override !== undefined) {
        return { ...item, isAttendanceTarget: override };
      }
      return item;
    });
  },

  /** 단일 프로필 조회 */
  async get(id: string): Promise<EmployeeProfile | null> {
    const all = await this.list();
    return all.find((p) => p.id === id || p.userId === id) ?? null;
  },

  /** 프로필 등록 또는 수정 (upsert) */
  async save(item: EmployeeProfile): Promise<void> {
    const now = new Date().toISOString();
    if (item.isAttendanceTarget !== undefined) {
      // 프로필 id 키가 가장 우선이라 이 한 건으로 옛 userId·사번 키 값도 덮인다
      await attendanceTargetBackend.save({ targetKey: item.id, isTarget: item.isAttendanceTarget, updatedAt: now });
    }
    await backend.save({
      ...item,
      updatedAt: now,
    });
  },

  /** 단일 프로필 삭제 */
  async delete(id: string): Promise<void> {
    await backend.remove(id);
  },
};
