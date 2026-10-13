/**
 * 연차 수동 가감(조정) 트랜잭션 저장소
 *
 * [엄격 규칙: rule-readonly.md]
 * 기존 실제 DB(appwrite, garage s3)의 결재 문서 및 마스터 데이터를 일체 수정하지 않고,
 * 관리자가 부여한 포상휴가(+), 공제(-), 특별조정 내역을 독립 컬렉션(leaveAdjustments)에 격리 보관합니다.
 */
import { z } from 'zod';
import { createCrudBackend } from '@/data/_backend/crudBackend';
import { createSharedListStore } from '@/data/_backend/sharedListStore';

export type AdjustmentType = 'REWARD' | 'PENALTY' | 'SPECIAL' | 'CARRYOVER' | 'MANUAL';

export interface LeaveAdjustmentTransaction {
  id: string;
  empId?: number | null;
  empName: string;
  empNo?: string | null;
  type: AdjustmentType;
  deltaDays: number; // +1.0, -0.5 등
  reason: string;
  grantedAt: string; // YYYY-MM-DD
  grantedBy: string; // 등록한 관리자 성명
  createdAt: string; // ISO string
}

/** 화면 갱신용 이벤트 — 목록이 바뀌면(저장·삭제·DB 재조회) 발생한다. */
export const LEAVE_ADJUSTMENT_UPDATED_EVENT = 'workfit-leave-adjustment-updated';
/** 예전 브라우저 저장 키 — DB 이전([[migrateLegacySharedSettings]]) 때만 읽는다. */
export const LEGACY_ADJUSTMENT_STORAGE_KEY = 'workfit_leave_adjustments_v1';

const adjustmentSchema = z.object({
  id: z.string().min(1),
  empId: z.number().nullish(),
  empName: z.string().min(1),
  empNo: z.string().nullish(),
  type: z.enum(['REWARD', 'PENALTY', 'SPECIAL', 'CARRYOVER', 'MANUAL']),
  deltaDays: z.number(),
  reason: z.string().nullish().transform((v) => v ?? ''),
  grantedAt: z.string().nullish().transform((v) => v ?? ''),
  grantedBy: z.string().nullish().transform((v) => v ?? ''),
  createdAt: z.string().nullish().transform((v) => v ?? ''),
});

export function parseAdjustment(raw: unknown): LeaveAdjustmentTransaction | null {
  const p = adjustmentSchema.safeParse(raw);
  return p.success ? p.data : null;
}

export const leaveAdjustmentBackend = createCrudBackend<LeaveAdjustmentTransaction>({
  coll: 'leaveAdjustments',
  parse: parseAdjustment,
  idOf: (x) => x.id,
  seed: [],
  stripFields: ['id'], // id 는 문서 $id 로 저장되고 읽을 때 복원된다
});

/** 전 임직원 공용 — DB(leaveAdjustments)가 원천이고 화면 조회용으로 메모리에 캐시한다. */
export const leaveAdjustmentStore = createSharedListStore<LeaveAdjustmentTransaction>({
  backend: leaveAdjustmentBackend,
  idOf: (x) => x.id,
  event: LEAVE_ADJUSTMENT_UPDATED_EVENT,
});

/** 전체 조정 내역(최근 등록순). */
export function getStoredAdjustments(): LeaveAdjustmentTransaction[] {
  return [...leaveAdjustmentStore.getAll()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** 조정 내역 등록 — DB 저장이 끝나야 반환된다(실패 시 오류). */
export async function saveAdjustment(
  adjustment: Omit<LeaveAdjustmentTransaction, 'id' | 'createdAt'>,
): Promise<LeaveAdjustmentTransaction> {
  const newTx: LeaveAdjustmentTransaction = {
    ...adjustment,
    id: `adj-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    createdAt: new Date().toISOString(),
  };
  await leaveAdjustmentStore.save(newTx);
  return newTx;
}

// 특정 사원의 가감 트랜잭션 목록 및 총합 계산
export function getAdjustmentsForEmployee(
  empName: string,
  adjustments: LeaveAdjustmentTransaction[] = getStoredAdjustments(),
): { list: LeaveAdjustmentTransaction[]; totalDelta: number } {
  const norm = (s?: string | null) => (s || '').replace(/\s+/g, '');
  const targetNorm = norm(empName);

  const matched = adjustments.filter((tx) => norm(tx.empName) === targetNorm);
  const totalDelta = matched.reduce((sum, tx) => sum + tx.deltaDays, 0);

  return { list: matched, totalDelta };
}
