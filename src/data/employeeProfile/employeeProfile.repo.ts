import { employeeProfileSchema, type EmployeeProfile } from '@/domain/employeeProfile/schema';
import { createCrudBackend } from '@/data/_backend/crudBackend';

const STORAGE_KEY = 'workfit-attendance-target-overrides';

function getAttendanceOverrides(): Record<string, boolean> {
  try {
    const raw = typeof window !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function setAttendanceOverride(id: string, isTarget: boolean) {
  try {
    if (typeof window === 'undefined') return;
    const map = getAttendanceOverrides();
    map[id] = isTarget;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // ignore
  }
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
  /** 전체 임직원 인사 프로필 목록 조회 */
  async list(): Promise<EmployeeProfile[]> {
    const items = await backend.loadAll();
    const overrides = getAttendanceOverrides();
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
      setAttendanceOverride(item.id, item.isAttendanceTarget);
      if (item.userId) setAttendanceOverride(item.userId, item.isAttendanceTarget);
      if (item.empNo) setAttendanceOverride(item.empNo, item.isAttendanceTarget);
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
