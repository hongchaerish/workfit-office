import { seatLayoutSchema, type SeatLayout } from '@/domain/seatLayout/schema';
import { createCrudBackend } from '@/data/_backend/crudBackend';
import { fileStorage } from '@/shared/lib/storage';

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
  // Appwrite 속성은 스칼라만 — 좌석 배열은 JSON 문자열로 저장한다. id 는 문서 $id 로 대신한다.
  jsonFields: ['seats'],
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

  /**
   * 배치도 이미지 업로드 — 경로·URL을 돌려준다. 화면은 URL을 그대로 쓴다(결재 첨부·갤러리와 같은 방식).
   * 저장소 서명 API는 허용된 경로만 받는다 — 결재·게시판·갤러리처럼 `chat/<모듈>/` 아래에 둔다.
   */
  async uploadImage(layoutId: string, file: File): Promise<{ path: string; url: string }> {
    const ext = (file.name.split('.').pop() || 'png').toLowerCase().replace(/[^a-z0-9]/g, '') || 'png';
    const path = `chat/seat-layouts/${layoutId}-${Date.now()}.${ext}`;
    const url = await fileStorage.put(path, file, { contentType: file.type || 'image/png' });
    return { path, url };
  },
};
