import { departmentSchema, type Department } from '@/domain/department/schema';
import { assertMasterAccountNoDept } from '@/domain/user/masterAccount';
import { DEPARTMENT_SEED } from '@/data/seeds/department.seed';
import { createCrudBackend } from '@/data/_backend/crudBackend';

/**
 * 부서 Repository — DB 접근을 캡슐화하는 유일한 계층.
 * ([[DB_이관_대비_설계원칙.md]] 원칙 1 / [[Firestore_Appwrite_이관_단계별_계획서]] Phase 3)
 * 저장은 공유 CrudBackend(VITE_DB_DRIVER)로 위임. 파생 로직만 여기 유지.
 */
const backend = createCrudBackend<Department>({
  coll: 'departments',
  parse: (raw) => {
    const p = departmentSchema.safeParse(raw);
    if (!p.success) {
      console.error('Failed to parse department:', p.error);
      return null;
    }
    return p.data;
  },
  idOf: (d) => d.id,
  seed: DEPARTMENT_SEED.map((d) => departmentSchema.parse(d)),
});

export const departmentRepo = {
  /** 전체 조회(마스터 규모상 전건 로드). */
  async list(): Promise<Department[]> {
    return backend.loadAll();
  },

  async get(id: string): Promise<Department | null> {
    return (await backend.loadAll()).find((d) => d.id === id) ?? null;
  },

  /** 등록/수정(upsert). 문서 ID = department.id. */
  async save(item: Department): Promise<void> {
    if (item.headUserId) assertMasterAccountNoDept(item.headUserId);
    await backend.save(departmentSchema.parse(item));
  },

  /** 순서 번호만 저장 — 다른 칸(이름·부서장 등)은 건드리지 않아 동시에 고친 내용을 덮어쓰지 않는다 */
  async saveOrder(id: string, order: number): Promise<void> {
    await backend.patch(id, { order } as Partial<Department>);
  },

  /** 삭제. 문서 ID = department.id. */
  async remove(id: string): Promise<void> {
    await backend.remove(id);
  },
};
