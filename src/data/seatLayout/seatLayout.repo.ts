import { seatLayoutSchema, type SeatLayout } from '@/domain/seatLayout/schema';
import { createCrudBackend } from '@/data/_backend/crudBackend';

/**
 * 좌석 배치도 Repository — DB 접근을 캡슐화하는 유일한 계층.
 * 저장은 공유 CrudBackend(VITE_DB_DRIVER)로 위임한다. 신규 컬렉션(seatLayouts)이라 기존 데이터와 섞이지 않는다.
 */
const backend = createCrudBackend<SeatLayout>({
  coll: 'seatLayouts',
  parse: (raw) => {
    const p = seatLayoutSchema.safeParse(raw);
    if (!p.success) {
      console.error('Failed to parse seatLayout:', p.error);
      return null;
    }
    return p.data;
  },
  idOf: (x) => x.id,
  seed: [],
  // Appwrite 속성은 스칼라만 — 격자(칸 수·블록 목록)는 JSON 문자열로 저장한다. id 는 문서 $id 로 대신한다.
  jsonFields: ['grid'],
  stripFields: ['id'],
});

export const seatLayoutRepo = {
  async list(): Promise<SeatLayout[]> {
    return (await backend.loadAll()).sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'ko'));
  },

  async save(item: SeatLayout): Promise<void> {
    await backend.save(seatLayoutSchema.parse(item));
  },

  async remove(id: string): Promise<void> {
    await backend.remove(id);
  },
};
