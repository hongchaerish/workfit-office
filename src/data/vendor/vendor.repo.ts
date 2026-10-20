import { vendorSchema, type Vendor } from '@/domain/vendor/schema';
import { VENDOR_SEED } from '@/data/seeds/vendor.seed';
import { createCrudBackend } from '@/data/_backend/crudBackend';

/**
 * 거래처 Repository — DB 접근을 캡슐화하는 유일한 계층.
 * ([[DB_이관_대비_설계원칙.md]] 원칙 1 / [[Firestore_Appwrite_이관_단계별_계획서]] Phase 3)
 * 저장은 공유 CrudBackend(VITE_DB_DRIVER)로 위임. 파생 로직만 여기 유지.
 */
const backend = createCrudBackend<Vendor>({
  coll: 'vendors',
  parse: (raw) => {
    const p = vendorSchema.safeParse(raw);
    if (!p.success) {
      console.error('Failed to parse vendor:', p.error);
      return null;
    }
    return p.data;
  },
  idOf: (v) => v.code,
  seed: VENDOR_SEED.map((v) => vendorSchema.parse(v)),
});

export interface VendorFilter {
  type?: string;
  use?: string;
  q?: string;
}

function applyFilter(rows: Vendor[], f?: VendorFilter): Vendor[] {
  if (!f) return rows;
  const kw = f.q?.trim().toLowerCase() ?? '';
  return rows.filter(
    (v) =>
      (!f.type || v.type === f.type) &&
      (!f.use || v.use === f.use) &&
      (!kw || v.code.toLowerCase().includes(kw) || v.name.toLowerCase().includes(kw)),
  );
}

export const vendorRepo = {
  async list(filter?: VendorFilter): Promise<Vendor[]> {
    return applyFilter(await backend.loadAll(), filter);
  },

  async get(code: string): Promise<Vendor | null> {
    return (await backend.loadAll()).find((v) => v.code === code) ?? null;
  },

  /** 등록/수정(upsert). 문서 ID = 거래처코드. */
  async save(vendor: Vendor): Promise<void> {
    await backend.save(vendorSchema.parse(vendor));
  },

  /**
   * 신규 등록 — 같은 거래처코드가 있으면 덮어쓰지 않고 `DocumentExistsError`.
   * 컬렉션이 없을 때도 조용히 건너뛰지 않고 오류를 낸다(save 는 404 를 건너뛴다).
   */
  async create(vendor: Vendor): Promise<void> {
    await backend.insert(vendorSchema.parse(vendor));
  },

  async remove(code: string): Promise<void> {
    await backend.remove(code);
  },
};
