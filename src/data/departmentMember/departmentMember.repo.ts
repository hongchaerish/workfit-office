import { departmentMemberSchema, type DepartmentMember, type DepartmentMemberInput } from '@/domain/departmentMember/schema';
import { DEPARTMENT_MEMBER_SEED } from '@/data/seeds/departmentMember.seed';
import { createCrudBackend } from '@/data/_backend/crudBackend';
import { hideTestAccountRows } from '@/data/_backend/testAccountVisibility';
import { loadOrgMasters } from '@/data/_backend/orgMasters';
import type { OrgMasters } from '@/domain/employeeProfile/affiliation';

/**
 * 부서 소속/겸직 Repository — DB 접근 캡슐화.
 * 저장은 공유 CrudBackend(VITE_DB_DRIVER)로 위임.
 */
const backend = createCrudBackend<DepartmentMember>({
  coll: 'departmentMembers',
  parse: (raw) => {
    const p = departmentMemberSchema.safeParse(raw);
    if (!p.success) {
      console.error('Failed to parse departmentMember:', p.error);
      return null;
    }
    return p.data;
  },
  idOf: (m) => m.id,
  seed: DEPARTMENT_MEMBER_SEED.map((m) => departmentMemberSchema.parse(m)),
});

/**
 * 부서·직책 이름은 저장값이 아니라 ID(deptId·jobTitleId)로 기준정보에서 찾은 현재 이름이다.
 * 직책 ID가 아직 없는 옛 행은 저장된 직책 이름을 그대로 보여 준다.
 */
function withNames(m: DepartmentMember, masters: OrgMasters): DepartmentMember {
  const deptName = masters.depts.find((d) => d.id === m.deptId)?.name ?? m.deptName;
  const jobTitle = m.jobTitleId ? (masters.jobTitles.find((j) => j.id === m.jobTitleId)?.name ?? '') : m.jobTitle;
  return { ...m, deptName, jobTitle };
}

async function loadResolved(): Promise<DepartmentMember[]> {
  const [rows, masters] = await Promise.all([backend.loadAll(), loadOrgMasters()]);
  return rows.map((m) => withNames(m, masters));
}

export const departmentMemberRepo = {
  /** 전체 조회 — 접속자가 볼 수 없는 테스트 계정의 소속은 빠진다([[testAccountVisibility]]). */
  async list(): Promise<DepartmentMember[]> {
    return hideTestAccountRows(await loadResolved(), (m) => [m.userId]);
  },

  /** 특정 사용자의 소속 목록 (본직 1개 + 겸직 N개) */
  async listByUserId(userId: string): Promise<DepartmentMember[]> {
    const all = await loadResolved();
    return all.filter((m) => m.userId === userId);
  },

  /** 특정 부서의 소속 구성원 목록 (본직자 + 겸직자 포함) */
  async listByDeptId(deptId: string): Promise<DepartmentMember[]> {
    const all = await this.list();
    return all.filter((m) => m.deptId === deptId);
  },

  /** 단일 소속 조회 */
  async get(id: string): Promise<DepartmentMember | null> {
    const all = await loadResolved();
    return all.find((m) => m.id === id) ?? null;
  },

  /** 등록/수정 (upsert) */
  async save(item: DepartmentMemberInput): Promise<DepartmentMember> {
    const parsed = departmentMemberSchema.parse(item);
    // 고른 직책 이름을 ID로(못 찾으면 기존 ID 유지), 이름 칸은 현재 이름 사본
    const masters = await loadOrgMasters();
    const jobTitleId = parsed.jobTitle ? (masters.jobTitles.find((j) => j.name === parsed.jobTitle)?.id ?? parsed.jobTitleId) : null;
    const saved = withNames({ ...parsed, jobTitleId }, masters);
    await backend.save(saved);
    return saved;
  },

  /** 삭제 */
  async remove(id: string): Promise<void> {
    await backend.remove(id);
  },
};
