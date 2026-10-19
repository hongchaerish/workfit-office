import { z } from 'zod';
import { employeeProfileSchema, type EmployeeProfile } from '@/domain/employeeProfile/schema';
import { createCrudBackend } from '@/data/_backend/crudBackend';
import { hideTestAccountRows } from '@/data/_backend/testAccountVisibility';
import { isTestAccount } from '@/domain/user/testAccount';
import { affiliationIdsFromNames, resolveAffiliation } from '@/domain/employeeProfile/affiliation';
import { loadOrgMasters } from '@/data/_backend/orgMasters';

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
 * 생일 설정(음력 여부·공개 여부) — 사용자 id 키 독립 컬렉션. employeeProfiles 원본은 건드리지 않고
 * 읽을 때 덧씌운다(근태 대상 여부와 같은 방식). 본인이 프로필 설정에서 바꾼다.
 */
export interface BirthdaySetting {
  userId: string;
  birthLunar: boolean;
  birthdayPublic: boolean;
  updatedAt?: string | null;
}

const birthdaySettingSchema = z.object({
  userId: z.string().min(1),
  birthLunar: z.boolean().nullish().transform((v) => v ?? false),
  birthdayPublic: z.boolean().nullish().transform((v) => v ?? true),
  updatedAt: z.string().nullish(),
});

export const birthdaySettingBackend = createCrudBackend<BirthdaySetting>({
  coll: 'birthdaySettings',
  parse: (raw) => {
    const p = birthdaySettingSchema.safeParse(raw);
    return p.success ? p.data : null;
  },
  idOf: (x) => x.userId,
  seed: [],
});

/** 본인이 프로필 설정에서 고칠 수 있는 항목. 소속·직급·주민번호 등은 인사 관리자만 바꾼다. */
export const SELF_EDITABLE_PROFILE_FIELDS = [
  'phone',
  'personalEmail',
  'emergencyPhone',
  'address',
  'birthDate',
  'birthLunar',
  'birthdayPublic',
] as const;
export type SelfEditableProfilePatch = Partial<Pick<EmployeeProfile, (typeof SELF_EDITABLE_PROFILE_FIELDS)[number]>>;

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
  stripFields: ['isAttendanceTarget', 'birthLunar', 'birthdayPublic'],
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
    const [items, overrides, birthdaySettings, masters] = await Promise.all([
      backend.loadAll(),
      loadAttendanceOverrides(),
      birthdaySettingBackend.loadAll(),
      loadOrgMasters(),
    ]);
    const birthdayByUser = new Map(birthdaySettings.map((b) => [b.userId, b]));
    return items.map((item) => {
      const override = overrides[item.id] ?? overrides[item.userId] ?? overrides[item.empNo];
      const birthday = birthdayByUser.get(item.userId);
      return {
        ...item,
        // 소속 이름은 저장값이 아니라 ID로 기준정보에서 찾은 현재 이름
        ...resolveAffiliation(item, masters, { isTest: isTestAccount({ id: item.userId, name: item.name }) }),
        ...(override !== undefined ? { isAttendanceTarget: override } : {}),
        ...(birthday ? { birthLunar: birthday.birthLunar, birthdayPublic: birthday.birthdayPublic } : {}),
      };
    });
  },

  /** 단일 프로필 조회 */
  async get(id: string): Promise<EmployeeProfile | null> {
    const all = await this.list();
    return all.find((p) => p.id === id || p.userId === id) ?? null;
  },

  /** 프로필 등록 또는 수정 (upsert) */
  async save(item: EmployeeProfile, opts: { keepAttendanceTarget?: boolean } = {}): Promise<void> {
    const now = new Date().toISOString();
    await birthdaySettingBackend.save({
      userId: item.userId,
      birthLunar: item.birthLunar ?? false,
      birthdayPublic: item.birthdayPublic ?? true,
      updatedAt: now,
    });
    if (!opts.keepAttendanceTarget && item.isAttendanceTarget !== undefined) {
      // 프로필 id 키가 가장 우선이라 이 한 건으로 옛 userId·사번 키 값도 덮인다
      await attendanceTargetBackend.save({ targetKey: item.id, isTarget: item.isAttendanceTarget, updatedAt: now });
    }
    // 화면에서 고른 소속 이름을 ID로 바꿔 저장한다. 이름 칸은 그 순간의 현재 이름 사본(읽지 않음).
    const masters = await loadOrgMasters();
    const ids = affiliationIdsFromNames(item, masters, item);
    const names = resolveAffiliation(ids, masters, { isTest: isTestAccount({ id: item.userId, name: item.name }) });
    await backend.save({
      ...item,
      ...names,
      updatedAt: now,
    });
  },

  /**
   * 본인 정보 수정(프로필 설정) — 허용된 항목만 바꾼다. 프로필이 아직 없으면 계정 정보로 새로 만든다.
   * 빈 문자열을 넣으면 그 항목을 지운다.
   */
  async updateMine(
    me: { id: string; empNo: string; name: string; dept: string; position: string; jobTitle?: string },
    patch: SelfEditableProfilePatch,
  ): Promise<EmployeeProfile> {
    const all = await this.listIncludingTestAccounts();
    const existing = all.find((p) => p.userId === me.id || p.id === me.id);
    const allowed = Object.fromEntries(
      Object.entries(patch).filter(([k]) => (SELF_EDITABLE_PROFILE_FIELDS as readonly string[]).includes(k)),
    );
    const next = employeeProfileSchema.parse({
      ...(existing ?? {
        id: me.id,
        userId: me.id,
        empNo: me.empNo || me.id,
        name: me.name,
        dept: me.dept || '미지정',
        position: me.position || '사원',
        jobTitle: me.jobTitle || '팀원',
      }),
      ...allowed,
    });
    // 근태 대상 여부는 본인 저장으로 바꾸지 않는다(관리자 설정 보존)
    await this.save(next, { keepAttendanceTarget: true });
    return next;
  },

  /** 단일 프로필 삭제 */
  async delete(id: string): Promise<void> {
    await backend.remove(id);
  },
};
