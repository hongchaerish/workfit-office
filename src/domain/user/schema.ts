import { z } from 'zod';

/**
 * 사용자(User) 도메인 스키마 — 단일 진실 공급원(SSOT).
 * roleGroup 은 roleGroups.code 참조(FK). ([[데이터_모델_설계서.md]] users)
 */
export const USER_STATUS = ['사용', '잠금', '미사용'] as const;
export type UserStatus = (typeof USER_STATUS)[number];

/**
 * 신규 사용자 공통 초기 비밀번호(데모). 사용자관리에서 등록 시 자동 부여되며,
 * 사용자는 로그인 후 비밀번호 변경으로 교체한다. seed 계정도 동일 값 사용.
 */
export const DEFAULT_USER_PASSWORD = 'mes1234';

export const userSchema = z.object({
  id: z.string().min(1),
  empNo: z.string().min(1, '사번을 입력하세요').max(20),
  name: z.string().min(1, '이름을 입력하세요').max(30),
  dept: z.string().default('미지정'),
  position: z.string().default('사원'),
  jobTitle: z.string().max(20).default(''),
  email: z.string().min(1, '이메일을 입력하세요').email('올바른 이메일 형식이 아닙니다'),
  status: z.enum(USER_STATUS).default('사용'),
  lastLogin: z.string().default('-'),
  /**
   * 직속 상급자 users.id (FK, nullable). 그룹웨어 조직도의 보고 계층 표현 +
   * 전자결재 자동 상신선(상급자 체인)의 원천. 미지정(최상위)이면 null.
   * ([[groupware-feature]] · docs/전자결재_워크플로_개발_계획서.md §3.1)
   */
  managerId: z.string().nullable().default(null),
  /**
   * 로그인 비밀번호. ⚠ 데모 한정 평문 저장 — 실제 보안 아님.
   * 진짜 인증은 후속(Cloud Function custom token)으로 전환 예정. ([[firebase-backend-setup]])
   */
  password: z.string().default(''),
  /**
   * 인감(도장) 이미지 URL. Firebase Storage 업로드 URL 또는 base64 data URL(데모 폴백).
   * 전자결재 문서 서명란에 표시된다. 미등록 시 빈 문자열.
   */
  sealUrl: z.string().default(''),
  signUrl: z.string().optional().default(''),
  signType: z.enum(['stamp', 'signature']).optional().default('stamp'),
  photoUrl: z.string().default(''),
  activeChatRoomId: z.string().nullable().optional(),
  /**
   * 퇴사 처리 일시(ISO). 빈 문자열 = 재직/해당없음. Phase1 퇴사 처리에서 기록.
   * 로그인 차단은 기존 status='미사용'과 연동(퇴사 처리 시 자동 세팅).
   */
  resignedAt: z.string().default(''),
  /**
   * 모바일 FCM 푸시 토큰(모바일 앱이 기록). 퇴사 처리 시 비운다.
   * 스키마에 명시해 웹 저장 시에도 보존되도록 함(과거엔 파싱에서 탈락).
   */
  fcmToken: z.string().default(''),
  /**
   * 다중 소속(겸직) 확장 스키마 (User.dept 단일 구조의 점진적 확장 대비).
   */
  assignments: z.array(
    z.object({
      deptId: z.string(),
      deptName: z.string().optional(),
      role: z.enum(['HEAD', 'MEMBER']).default('MEMBER'),
      isPrimary: z.boolean().default(false),
    })
  ).optional(),
});

export const userAssignmentSchema = z.object({
  deptId: z.string(),
  deptName: z.string().optional(),
  role: z.enum(['HEAD', 'MEMBER']).default('MEMBER'),
  isPrimary: z.boolean().default(false),
});

export type UserAssignment = z.infer<typeof userAssignmentSchema>;
export type User = z.infer<typeof userSchema>;

/** 폼 입력값(시스템 필드 제외). default 없이 정의해 RHF 입력/출력 타입 일치. */
export const userFormSchema = z.object({
  empNo: z.string().min(1, '사번을 입력하세요').max(20),
  name: z.string().min(1, '이름을 입력하세요').max(30),
  dept: z.string().default('미지정'),
  position: z.string().default('사원'),
  jobTitle: z.string().default(''),
  email: z.string().min(1, '이메일을 입력하세요').email('올바른 이메일 형식이 아닙니다'),
  status: z.enum(USER_STATUS),
  password: z.string().max(50).optional(),
  photoUrl: z.string().optional(),
});
export type UserFormValues = z.infer<typeof userFormSchema>;
