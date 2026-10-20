import { createCrudBackend } from '@/data/_backend/crudBackend';
import { poReplySchema, type PoReply } from '@/domain/poArchive/schema';
import type { ApprovalDoc } from '@/domain/approvalDoc/schema';
import { fileStorage } from '@/shared/lib/storage';

/**
 * 발주서 회신 문서 Repository — 메타는 `poArchiveReplies` 컬렉션, 파일은 fileStorage(Garage S3).
 * 결재 문서(approvalDocs)는 읽기만 하고 여기서 절대 쓰지 않는다(CLAUDE.md §2).
 */
const backend = createCrudBackend<PoReply>({
  coll: 'poArchiveReplies',
  parse: (raw) => {
    const parsed = poReplySchema.safeParse(raw);
    return parsed.success ? parsed.data : null;
  },
  idOf: (row) => row.docId,
  seed: [],
});

/** 확장자만 남긴 저장 경로 — 한글 파일명은 다운로드 이름(filename)으로만 보존한다. */
function storagePathOf(docId: string, fileName: string, now: Date): string {
  const ext = /\.([A-Za-z0-9]{1,8})$/.exec(fileName)?.[1]?.toLowerCase();
  return `poArchive/${docId}/reply-${now.getTime()}${ext ? `.${ext}` : ''}`;
}

export const poReplyRepo = {
  async list(): Promise<PoReply[]> {
    return backend.loadAll();
  },

  /**
   * 회신 문서 올리기 — 문서당 1건. 다시 올리면 교체하고 이전 파일은 지운다(best-effort).
   * 첫 등록은 `insert` 라 컬렉션이 없으면 조용히 건너뛰지 않고 오류를 낸다 — 파일은 올라갔는데
   * 목록에 안 보이는 사고를 막는다.
   */
  async upload(doc: Pick<ApprovalDoc, 'id' | 'docNo'>, file: File, actor: { id: string; name: string }): Promise<PoReply> {
    const prev = (await backend.loadAll()).find((r) => r.docId === doc.id) ?? null;
    const now = new Date();
    const storagePath = storagePathOf(doc.id, file.name, now);
    const url = await fileStorage.put(storagePath, file, {
      contentType: file.type || 'application/octet-stream',
      filename: file.name,
    });
    // 저장소 미설정 시 data URL 폴백이 돌아온다 — url 512자 제한에 걸리기 전에 원인을 밝힌다.
    if (url.length > 512) {
      throw new Error('파일 저장소가 설정되지 않아 회신 문서를 저장할 수 없습니다. 관리자에게 Storage 설정을 요청하세요.');
    }
    const row = poReplySchema.parse({
      docId: doc.id,
      docNo: doc.docNo,
      name: file.name,
      url,
      storagePath,
      size: file.size,
      contentType: file.type || 'application/octet-stream',
      uploadedBy: actor.id,
      uploadedByName: actor.name,
      uploadedAt: now.toISOString(),
    });
    try {
      if (prev) await backend.save(row);
      else await backend.insert(row);
    } catch (err) {
      await fileStorage.remove(storagePath).catch(() => undefined);
      throw err;
    }
    if (prev?.storagePath && prev.storagePath !== storagePath) {
      await fileStorage.remove(prev.storagePath).catch(() => undefined);
    }
    return row;
  },

  /** 다운로드 URL — 서명 URL을 새로 받아 만료를 피하고, 실패하면 저장된 URL을 쓴다. */
  async downloadUrl(reply: PoReply): Promise<string> {
    if (!reply.storagePath) return reply.url;
    try {
      return await fileStorage.getSignUrl(reply.storagePath, 'attachment');
    } catch {
      return reply.url;
    }
  },
};
