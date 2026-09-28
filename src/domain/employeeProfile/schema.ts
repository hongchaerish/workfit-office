import { z } from 'zod';

/**
 * 임직원 인사 마스터 employeeProfiles 스키마.
 * 계정 인증(users)과 독립적으로 인사 정보, 발령 부서, 직급, 직책 및 개인 신상정보를 보관.
 */
export const EMPLOYMENT_STATUS = ['ACTIVE', 'LEAVE', 'RETIRED'] as const;
export type EmploymentStatus = (typeof EMPLOYMENT_STATUS)[number];

const nullableString = z.preprocess((v) => (v == null ? '' : String(v)), z.string().default(''));

export const employeeProfileSchema = z.object({
  /** 프로필 고유 ID (PK, 보통 userId와 동일) */
  id: z.string().min(1),
  /** 매핑된 users 계정 ID (FK) */
  userId: z.string().min(1),
  /** 사번 */
  empNo: z.string().min(1),
  /** 이름 */
  name: z.string().min(1),
  /** 소속 부서 */
  dept: z.string().default('미지정'),
  /** 직급 */
  position: z.string().default('사원'),
  /** 직책 */
  jobTitle: z.string().default('팀원'),
  /** 재직 상태 */
  status: z.enum(EMPLOYMENT_STATUS).default('ACTIVE'),
  /** 근태 관리 대상 여부 (true: 대상[기본], false: 전사관리 제외[비상근/대표이사/부위원장 등]) */
  isAttendanceTarget: z.preprocess((v) => (v == null ? true : typeof v === 'boolean' ? v : String(v) !== 'false'), z.boolean().default(true)),
  /** 업무/개인 연락처 */
  phone: nullableString,
  /** 입사일 (YYYY-MM-DD) */
  hireDate: nullableString,
  /** 주민등록번호 */
  rrn: nullableString,
  /** 생년월일 */
  birthDate: nullableString,
  /** 성별 (남성 / 여성) */
  gender: nullableString,
  /** 자택 주소 */
  address: nullableString,
  /** 개인 이메일 */
  personalEmail: nullableString,
  /** 비상 연락처 */
  emergencyPhone: nullableString,
  /** 최종 학력 */
  education: nullableString,
  /** 최종 수정일시 (ISO) */
  updatedAt: nullableString,
});

export type EmployeeProfile = z.infer<typeof employeeProfileSchema>;

export const employeeProfileFormSchema = employeeProfileSchema.omit({
  updatedAt: true,
});

export type EmployeeProfileFormValues = z.infer<typeof employeeProfileFormSchema>;
