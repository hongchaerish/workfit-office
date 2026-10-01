import { approvalPostReadShareSchema, type ApprovalPostReadShare } from '@/domain/approvalPostRead/schema';
import { createCrudBackend, Query } from '@/data/_backend/crudBackend';
import { notificationRepo } from '@/data/notification/notification.repo';

/**
 * 후열(공람) 전달 Repository — 컬렉션 approvalPostReadShares.
 * 예전에는 전달한 사람 브라우저의 localStorage 에만 남아 수신자 쪽에서는 존재하지 않았다.
 * approvalDocs 는 읽기 전용이라 문서에 쓰지 않고 이 컬렉션에 따로 둔다.
 */
const backend = createCrudBackend<ApprovalPostReadShare>({
  coll: 'approvalPostReadShares',
  parse: (raw) => {
    const p = approvalPostReadShareSchema.safeParse(raw);
    return p.success ? p.data : null;
  },
  idOf: (x) => x.id,
  seed: [],
});

export interface SharePostReadInput {
  doc: { id: string; docNo: string; title: string };
  fromUserId: string;
  fromUserName: string;
  toUserId: string;
  toUserName: string;
  toUserDept: string;
  memo: string;
}

const newestFirst = (a: ApprovalPostReadShare, b: ApprovalPostReadShare) => b.sentAt.localeCompare(a.sentAt);

export const approvalPostReadRepo = {
  /** Memory·Firestore 드라이버는 쿼리를 무시하고 전체를 주므로 JS 에서도 한 번 더 거른다. */
  async listByRecipients(userIds: string[]): Promise<ApprovalPostReadShare[]> {
    const ids = userIds.filter(Boolean);
    if (ids.length === 0) return [];
    const rows = await backend.loadWithQueries([Query.equal('toUserId', ids)]);
    return rows.filter((s) => ids.includes(s.toUserId)).sort(newestFirst);
  },

  async listByDoc(docId: string): Promise<ApprovalPostReadShare[]> {
    const rows = await backend.loadWithQueries([Query.equal('docId', docId)]);
    return rows.filter((s) => s.docId === docId).sort(newestFirst);
  },

  /** 저장이 핵심, 알림은 부가 — 알림이 실패해도 전달은 성공으로 돌려준다(notified=false). */
  async share(input: SharePostReadInput): Promise<{ share: ApprovalPostReadShare; notified: boolean }> {
    if (!input.toUserId) throw new Error('후열로 전달할 대상자를 선택해주세요.');
    if (!input.fromUserId) throw new Error('전달자 정보를 확인할 수 없습니다.');
    if (input.toUserId === input.fromUserId) throw new Error('본인에게는 후열 전달할 수 없습니다.');

    const share = approvalPostReadShareSchema.parse({
      id: `prs-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      docId: input.doc.id,
      docNo: input.doc.docNo,
      docTitle: input.doc.title,
      fromUserId: input.fromUserId,
      fromUserName: input.fromUserName,
      toUserId: input.toUserId,
      toUserName: input.toUserName,
      toUserDept: input.toUserDept,
      memo: input.memo.trim(),
      sentAt: new Date().toISOString(),
      readAt: null,
    });
    await backend.save(share);

    let notified = true;
    try {
      await notificationRepo.create({
        userId: share.toUserId,
        type: '결재',
        title: '후열 문서 전달',
        text: `[${share.docNo}] ${share.docTitle}`,
        senderName: share.fromUserName,
        linkUrl: `/gw/approval?doc=${share.docId}`,
      });
    } catch (e) {
      notified = false;
      console.error('[approvalPostRead] 후열 전달 알림 생성 실패', e);
    }
    return { share, notified };
  },

  /** 열람 자동 확인 — 이미 확인된 건은 그대로 둔다(멱등). 없는 id 는 null. */
  async markRead(id: string): Promise<ApprovalPostReadShare | null> {
    const rows = await backend.loadAll();
    const cur = rows.find((s) => s.id === id);
    if (!cur) return null;
    if (cur.readAt) return cur;
    const next = { ...cur, readAt: new Date().toISOString() };
    await backend.save(next);
    return next;
  },

  /** 예전 localStorage 기록 이관. 이미 있는 id 는 건너뛰고, 과거 건이라 알림은 보내지 않는다. */
  async importLegacy(items: ApprovalPostReadShare[]): Promise<{ imported: number; skipped: number; failed: number }> {
    const existing = new Set((await backend.loadAll()).map((s) => s.id));
    let imported = 0;
    let skipped = 0;
    let failed = 0;
    for (const it of items) {
      if (existing.has(it.id)) {
        skipped++;
        continue;
      }
      try {
        await backend.save(it);
        existing.add(it.id);
        imported++;
      } catch (e) {
        failed++;
        console.error('[approvalPostRead] 레거시 후열 전달 이관 실패', it.id, e);
      }
    }
    return { imported, skipped, failed };
  },
};
