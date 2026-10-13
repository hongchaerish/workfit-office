/**
 * 대체휴무(대휴) 발생 및 일괄 부여 트랜잭션 저장소
 *
 * [엄격 규칙: rule-readonly.md]
 * 기존 실제 DB(appwrite, garage s3)의 결재 문서 및 마스터 데이터를 일체 수정하지 않고,
 * 관리자가 전사 또는 특정 대상자에게 부여한 대체휴무 발생 내역을 독립 컬렉션(substituteHolidayGrants)에 격리 보관합니다.
 *
 * [옵션 B: 시스템 프리셋 미지원]
 * 시스템 기본 하드코딩 프리셋을 두지 않으며, 관리자가 화면을 통해 직접 부여한 내역만 관리합니다.
 */
import { z } from 'zod';
import { createCrudBackend } from '@/data/_backend/crudBackend';
import { createSharedListStore } from '@/data/_backend/sharedListStore';

export interface SubstituteHolidayGrant {
  id: string;
  targetScope: 'ALL' | string[]; // 'ALL': 전체 임직원, string[]: 대상 사번/ID/성명
  targetScopeLabel: string; // "전체 임직원" 또는 "개발본부 (5명)" 등
  occurrenceDate: string; // 휴일근무 발생일 (YYYY-MM-DD, 예: "2026-08-17")
  expirationDate: string; // 사용 유효만료일 (YYYY-MM-DD, 기본 발생일 + 1년)
  days: number; // 부여 일수 (1.0, 0.5 등)
  reason: string; // 발생 사유 (예: "8/17 대체공휴일 특근", "8/29 토요 특근")
  grantedBy: string; // 부여 등록 관리자명
  grantedAt: string; // ISO string 또는 YYYY-MM-DD
  createdAt: string; // 등록 일시 ISO string
}

export interface SubstituteHolidayItemInput {
  id: string;
  occurrenceDate: string;
  expirationDate: string;
  reason: string;
  days: number;
}

/** 예전 브라우저 저장 키 — DB 이전([[migrateLegacySharedSettings]]) 때만 읽는다. */
export const LEGACY_SUBSTITUTE_HOLIDAY_STORAGE_KEY = 'workfit_substitute_holidays_v1';
export const SUBSTITUTE_HOLIDAY_UPDATED_EVENT = 'workfit-substitute-holiday-updated';

const grantSchema = z.object({
  id: z.string().min(1),
  targetScope: z.union([z.literal('ALL'), z.array(z.string())]),
  targetScopeLabel: z.string().nullish().transform((v) => v ?? ''),
  occurrenceDate: z.string().min(1),
  expirationDate: z.string().nullish().transform((v) => v ?? ''),
  days: z.number(),
  reason: z.string().nullish().transform((v) => v ?? ''),
  grantedBy: z.string().nullish().transform((v) => v ?? ''),
  grantedAt: z.string().nullish().transform((v) => v ?? ''),
  createdAt: z.string().nullish().transform((v) => v ?? ''),
});

export function parseSubstituteHolidayGrant(raw: unknown): SubstituteHolidayGrant | null {
  const p = grantSchema.safeParse(raw);
  return p.success ? p.data : null;
}

export const substituteHolidayBackend = createCrudBackend<SubstituteHolidayGrant>({
  coll: 'substituteHolidayGrants',
  parse: parseSubstituteHolidayGrant,
  idOf: (x) => x.id,
  seed: [],
  jsonFields: ['targetScope'],
  stripFields: ['id'], // id 는 문서 $id 로 저장되고 읽을 때 복원된다
});

/** 전 임직원 공용 — DB(substituteHolidayGrants)가 원천이고 화면 조회용으로 메모리에 캐시한다. */
export const substituteHolidayStore = createSharedListStore<SubstituteHolidayGrant>({
  backend: substituteHolidayBackend,
  idOf: (x) => x.id,
  event: SUBSTITUTE_HOLIDAY_UPDATED_EVENT,
});

/** 대체휴무 부여 목록(최근 등록순, 프리셋 없음). */
export function getStoredSubstituteHolidays(): SubstituteHolidayGrant[] {
  return [...substituteHolidayStore.getAll()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** 신규 대체휴무 부여 — DB 저장이 끝나야 반환된다(실패 시 오류). */
export async function saveSubstituteHolidayGrant(
  grant: Omit<SubstituteHolidayGrant, 'id' | 'createdAt'>,
): Promise<SubstituteHolidayGrant> {
  const newGrant: SubstituteHolidayGrant = {
    ...grant,
    id: `sub-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    createdAt: new Date().toISOString(),
  };
  await substituteHolidayStore.save(newGrant);
  return newGrant;
}

/** 대체휴무 부여 건 삭제/회수. 없는 건이면 false. */
export async function deleteSubstituteHolidayGrant(id: string): Promise<boolean> {
  if (!substituteHolidayStore.getAll().some((g) => g.id === id)) return false;
  await substituteHolidayStore.remove(id);
  return true;
}

/** 테스트 전용 — 저장소(메모리 백엔드)와 캐시를 비운다. */
export async function _resetSubstituteHolidayStoreForTest(): Promise<void> {
  for (const g of await substituteHolidayBackend.loadAll()) await substituteHolidayBackend.remove(g.id);
  substituteHolidayStore.setForTest([]);
}

/**
 * 특정 사용자(사원)에게 적용되는 대체휴무 원천 목록 조회
 * (전체 임직원 ALL 대상이거나 사원 ID/성명이 포함된 건)
 *
 * [규칙: 발생일 기준 미입사자 자동 제외]
 * 입사일(hireDate)이 휴일 특근 발생일(occurrenceDate)보다 나중인 경우 자동으로 제외합니다.
 */
export function getSubstituteHolidaysForUser(
  userId?: string | null,
  userName?: string | null,
  hireDate?: string | null,
  allGrants: SubstituteHolidayGrant[] = getStoredSubstituteHolidays(),
): SubstituteHolidayItemInput[] {
  if (!allGrants.length) return [];

  const norm = (s?: string | null) => (s || '').trim().toLowerCase();
  const targetId = norm(userId);
  const targetName = norm(userName);
  const cleanHireDate = (hireDate || '').trim();

  return allGrants
    .filter((g) => {
      // 발생일 기준 미입사자 (입사일이 발생일보다 나중인 사원) 자동 제외
      if (cleanHireDate && cleanHireDate.length === 10 && g.occurrenceDate && g.occurrenceDate.length === 10) {
        if (cleanHireDate > g.occurrenceDate) {
          return false;
        }
      }

      if (g.targetScope === 'ALL') return true;
      if (Array.isArray(g.targetScope)) {
        return g.targetScope.some((t) => {
          const normT = norm(t);
          return (targetId && normT === targetId) || (targetName && normT === targetName);
        });
      }
      return false;
    })
    .map((g) => ({
      id: g.id,
      occurrenceDate: g.occurrenceDate,
      expirationDate: g.expirationDate,
      reason: g.reason,
      days: g.days,
    }))
    .sort((a, b) => a.occurrenceDate.localeCompare(b.occurrenceDate)); // 선입선출(FIFO) 적용을 위한 발생일 오름차순 정렬
}
