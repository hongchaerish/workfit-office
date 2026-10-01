import { z } from 'zod';

/**
 * 기결재 문서 후열(공람) 전달 기록. approvalDocs 와 분리된 별도 컬렉션(approvalPostReadShares).
 * 기존 결재 문서는 읽기 전용이므로 전달 사실은 문서에 쓰지 않고 여기에만 남긴다.
 */
export const approvalPostReadShareSchema = z.object({
  /** 'prs-…' — 예전 localStorage 기록의 id 형식을 그대로 써서 이관 시 중복을 가린다. */
  id: z.string().min(1),
  docId: z.string().min(1),
  /** 전달 시점 스냅샷(이력 표시용). */
  docNo: z.string().default(''),
  docTitle: z.string().default(''),
  fromUserId: z.string().min(1),
  fromUserName: z.string().default(''),
  toUserId: z.string().min(1),
  toUserName: z.string().default(''),
  toUserDept: z.string().default(''),
  memo: z.string().default(''),
  sentAt: z.string().min(1),
  /** 수신자가 문서를 열람해 자동 확인된 시각(ISO). 미확인이면 null. */
  readAt: z.string().nullable().default(null),
});

export type ApprovalPostReadShare = z.infer<typeof approvalPostReadShareSchema>;
