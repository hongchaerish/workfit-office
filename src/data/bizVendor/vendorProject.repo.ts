import { createCrudBackend } from '@/data/_backend/crudBackend';
import {
  vendorProjectLinkId,
  vendorProjectLinkSchema,
  type VendorProjectLink,
  type VendorProjectRole,
} from '@/domain/bizVendor/schema';

/**
 * 거래처 ↔ 사업 연결 Repository — `bizVendorProjects` 컬렉션만 읽고 쓴다.
 * vendors·workProjects 는 여기서 건드리지 않는다.
 */
const backend = createCrudBackend<VendorProjectLink>({
  coll: 'bizVendorProjects',
  parse: (raw) => {
    const parsed = vendorProjectLinkSchema.safeParse(raw);
    return parsed.success ? parsed.data : null;
  },
  idOf: (row) => row.id,
  seed: [],
});

export const vendorProjectRepo = {
  async list(): Promise<VendorProjectLink[]> {
    return backend.loadAll();
  },

  /** 연결 — 이미 이어져 있으면 DocumentExistsError. 컬렉션이 없으면 조용히 건너뛰지 않고 오류. */
  async link(input: { vendorCode: string; projectId: string; role: VendorProjectRole; note?: string }, actorId: string): Promise<VendorProjectLink> {
    const row = vendorProjectLinkSchema.parse({
      id: vendorProjectLinkId(input.vendorCode, input.projectId),
      vendorCode: input.vendorCode,
      projectId: input.projectId,
      role: input.role,
      note: input.note?.trim() ?? '',
      createdBy: actorId,
      createdAt: new Date().toISOString(),
    });
    await backend.insert(row);
    return row;
  },

  /** 연결 해제 — 연결 행만 지운다. 거래처·사업 데이터는 그대로다. */
  async unlink(id: string): Promise<void> {
    await backend.remove(id);
  },
};
