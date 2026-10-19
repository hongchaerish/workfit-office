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
  /** 소속 부서 이름 — 읽을 때 deptId로 기준정보에서 채운다(저장값은 읽지 않는 사본) */
  dept: z.string().default('미지정'),
  /** 직급 이름 — 읽을 때 positionId로 채운다 */
  position: z.string().default('사원'),
  /** 직책 이름 — 읽을 때 jobTitleId로 채운다 */
  jobTitle: z.string().default('팀원'),
  /** 본직 부서·직급·직책 — 소속의 유일한 기준(기준정보 ID) */
  deptId: z.string().nullable().optional(),
  positionId: z.string().nullable().optional(),
  jobTitleId: z.string().nullable().optional(),
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
  /** 생년월일 (YYYY-MM-DD). `birthLunar`면 음력 날짜 */
  birthDate: nullableString,
  /**
   * 생년월일이 음력인가 / 생일 공개 여부 — 독립 컬렉션(birthdaySettings)에 두고 읽을 때 덧씌운다
   * (근태 대상 여부와 같은 방식). employeeProfiles 원본 문서에는 저장하지 않는다.
   * 값이 없으면 양력·공개.
   */
  birthLunar: z.preprocess((v) => (v == null ? false : v === true || v === 'true'), z.boolean().default(false)),
  birthdayPublic: z.preprocess((v) => (v == null ? true : !(v === false || v === 'false')), z.boolean().default(true)),
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
