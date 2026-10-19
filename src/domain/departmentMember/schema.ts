import { z } from 'zod';

/**
 * 부서 소속/겸직(DepartmentMember) 도메인 스키마 — 단일 진실 공급원(SSOT).
 *
 * 사용자와 부서 간의 N:M(다대다) 관계를 정규화한 교차 엔티티입니다.
 * - 한 임직원은 1개의 주소속(본직, isPrimary=true)과 0~N개의 겸직(isPrimary=false)을 보유할 수 있습니다.
 * - 각 소속마다 독립적인 직책(jobTitle)을 가질 수 있습니다 (예: 겸직 부서의 팀장).
 * - 단, 소속 부서가 '위원회'인 경우 직책은 빈 문자열('')로 강제됩니다.
 */
export const departmentMemberSchema = z.object({
  /** 고유 ID (PK) — `DM-{userId}-{deptId}` */
  id: z.string().min(1),
  /** 사용자 ID (FK -> users.id, employeeProfiles.userId) */
  userId: z.string().min(1, '사용자 ID는 필수입니다.'),
  /** 부서 ID (FK -> departments.id) */
  deptId: z.string().min(1, '부서 ID는 필수입니다.'),
  /** 부서명 (비정규화 캐시 — 조회 성능 최적화) */
  deptName: z.string().min(1, '부서명은 필수입니다.'),
  /**
   * 주 소속(원소속) 여부 (Primary Department)
   * - true: 본직 (주 소속 부서)
   * - false: 겸직 (추가 소속 부서)
   * ★ 무결성 규칙: 사용자 1명당 isPrimary === true는 시스템 전체에서 반드시 1개만 존재합니다.
   */
  isPrimary: z.boolean().default(false),
  /**
   * 해당 부서에서의 직책 (Job Title)
   * - 일반 부서: '팀장', '본부장', '파트장', '팀원' 등
   * ★ 위원회 규칙: 소속 부서의 deptType === '위원회'인 경우 빈 문자열('')로 고정됩니다.
   */
  jobTitle: z.string().default(''),
  /** 직책의 기준(기준정보 ID) — 읽을 때 jobTitle 이름을 이것으로 채운다 */
  jobTitleId: z.string().nullable().optional(),
  /** 표시/정렬 순서 */
  order: z.number().default(0),
  /** 발령/배정 일시 (ISO) */
  assignedAt: z.string().default(() => new Date().toISOString()),
  createdAt: z.string().default(() => new Date().toISOString()),
  updatedAt: z.string().default(() => new Date().toISOString()),
});

export type DepartmentMember = z.infer<typeof departmentMemberSchema>;
export type DepartmentMemberInput = z.input<typeof departmentMemberSchema>;

export const departmentMemberDraftSchema = departmentMemberSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type DepartmentMemberDraft = z.infer<typeof departmentMemberDraftSchema>;
