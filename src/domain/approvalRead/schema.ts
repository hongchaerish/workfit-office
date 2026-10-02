import { z } from 'zod';

/**
 * 전자결재 문서 읽음 기록 — "누가 어떤 문서를 언제 처음 열었는지" 한 행.
 * 안읽음 표시(domain/approvalDoc/unread)의 원천. 한 번 기록되면 바뀌지 않는다.
 * docId 가 `BASELINE_DOC_ID` 인 행은 '처음 적용 기준선을 남겼음' 표시다(문서 아님).
 */
export const approvalReadSchema = z.object({
  id: z.string().min(1),
  userId: z.string().min(1),
  docId: z.string().min(1),
  readAt: z.string().min(1),
});
export type ApprovalRead = z.infer<typeof approvalReadSchema>;

export const BASELINE_DOC_ID = '__baseline__';

export const approvalReadId = (userId: string, docId: string) => `${userId}__${docId}`;
