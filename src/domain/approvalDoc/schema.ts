import { z } from 'zod';

/**
 * 전자결재 문서(approvalDoc) 도메인 스키마 — 단일 진실 공급원(SSOT).
 *
 * 한국형 전자결재의 실무 개념(결재선 3방식·결재구분 5종·순차/병렬·상태머신)을
 * 데이터로 담는 범용 결재 엔진의 저장 모델.
 * 결재선(steps)은 **header-line 임베드**(boms/routings 패턴) — 항상 문서와 함께
 * 로드되고 소량이라 서브컬렉션 대신 문서에 임베드하며, 원자적 갱신 이점을 얻는다.
 * ([[groupware-feature]] · docs/전자결재_워크플로_개발_계획서.md §5)
 *
 * ⚠ steps 는 **배열-of-맵**(z.array(z.object)) 이라 Firestore 중첩배열 제약에
 * 걸리지 않는다(코덱 불필요). ([[이슈_Firestore_중첩배열_코덱.md]] 교훈 반영)
 * RDB 이관 시 approvalDocs=헤더 테이블, steps=라인 테이블로 분해. ([[DB_이관_대비_설계원칙.md]])
 */

/**
 * 기본 문서 종류(system 서식). approvalForms 도입 후 docType 은 서식 code(자유 문자열)이며,
 * 이 상수는 기본 4종 코드 + 기존 하위호환용 참조로만 사용한다.
 */
export const DOC_TYPES = ['기안', '품의', '지출결의', '휴가'] as const;
/** 문서 상태(§4.4 상태머신). */
export const DOC_STATUS = ['임시저장', '진행중', '반려', '완료', '회수', '삭제', '긴급 조치 사후 검토 반려', '시행대기', '시행반송', '취소완료'] as const;
/** 결재 구분 — 각 결재선 노드의 역할(§4.2). */
/** 전결은 2026-10-23 시스템에서 없앴다 — 예전 문서를 읽기 위해서만 값으로 남긴다(새 결재선에는 안 들어감). */
export const STEP_KINDS = ['결재', '합의', '참조', '전결', '대결'] as const;
/** 노드 결정. */
export const STEP_DECISIONS = ['대기', '승인', '반려', '보류'] as const;
/** 휴가 종류(§5.4). 오전반차(08:30~13:30), 오후반차(12:30~17:30) — 점심 포함 5시간 부재·사용 4시간, 반반차 세분화 */
export const LEAVE_TYPES = ['연차', '오전반차', '오후반차', '반차', '반반차', '병가', '경조', '공가', '대체휴무', '기타'] as const;
/** 문서 보안 등급 */
export const DOC_SECURITY_LEVELS = ['일반', '대외비', '극비'] as const;


export type DocType = (typeof DOC_TYPES)[number];
export type DocStatus = (typeof DOC_STATUS)[number];
export type StepKind = (typeof STEP_KINDS)[number];
export type StepDecision = (typeof STEP_DECISIONS)[number];
export type LeaveType = (typeof LEAVE_TYPES)[number];
export type SecurityLevel = (typeof DOC_SECURITY_LEVELS)[number];

/**
 * 결재선 노드(ApprovalStep) — 임베드 라인.
 * 순차는 seq 오름차순, 병렬(합의)은 같은 parallelGroup 태그로 동시 활성(§4.3).
 */
export const approvalStepSchema = z.object({
  /** 순서(직렬 기준, 1부터). */
  seq: z.number().int().min(1),
  /** 병렬 그룹 태그 — 같으면 동시 활성(합의용). null 이면 단독 순차. */
  parallelGroup: z.string().nullable().default(null),
  /** 승인 방식 — 'sequential' (순차) | 'parallel' (병렬) */
  executionType: z.enum(['sequential', 'parallel']).optional().default('sequential'),
  /** 결재 구분(§4.2). 참조=열람만(진행 막지 않음). 전결=예전 문서 기록용. */
  kind: z.enum(STEP_KINDS),
  /** 결재자 users.id(FK). */
  approverId: z.string().min(1),
  /** 대결 시 원 결재자 users.id — 대리 승인 위임 기록(§4.2 대결). */
  delegatedFromId: z.string().nullable().default(null),
  /** 노드 결정. */
  decision: z.enum(STEP_DECISIONS).default('대기'),
  /** 결정 시각(ISO). */
  decidedAt: z.string().nullable().default(null),
  /** 의견 — 반려 시 필수(엔진에서 강제). */
  comment: z.string().default(''),
  /** 원결재자 후열 확인 시각(ISO) — 대결 승인건에 대해 사후 확인한 시각. */
  postReadAt: z.string().nullable().optional(),
  /** 승인 당시 서명 이미지 URL (스냅샷) */
  signUrl: z.string().nullable().optional(),
  /** 승인 당시 도장 이미지 URL (스냅샷) */
  sealUrl: z.string().nullable().optional(),
  /** 승인 당시 서명 유형 (스냅샷) */
  signType: z.string().nullable().optional(),
  /** 승인 당시 성명 (스냅샷) */
  approverName: z.string().nullable().optional(),
  /** 승인 당시 직급 (스냅샷) */
  approverPos: z.string().nullable().optional(),
  /** 승인 당시 직책 (스냅샷) — 결재란 칭호(직책 우선)에 쓴다. 빈 값 = 직책 없었음 */
  approverTitle: z.string().nullable().optional(),
  /** 승인 당시 부서명 (스냅샷) */
  approverDept: z.string().nullable().optional(),
});

export type ApprovalStep = z.infer<typeof approvalStepSchema>;

/** 휴가 확장 필드(docType='휴가' 일 때만 유효, §5.4). */
export const leaveFormSchema = z.object({
  leaveType: z.enum(LEAVE_TYPES),
  /** 기간(date, YYYY-MM-DD). */
  startDate: z.string(),
  endDate: z.string(),
  /** 시작 시간 (예: "08:30", "13:30") */
  startTime: z.string().optional(),
  /** 종료 시간 (예: "12:30", "17:30") */
  endTime: z.string().optional(),
  /** 사용 일수(반차=0.5, 반반차=0.25). 잔여일수는 저장 안 하고 도출(§5.4). */
  days: z.number().min(0),
  /** 사유 */
  reason: z.string().optional(),
  /** 업무 대행자(대결자) ID 및 성명 */
  substituteId: z.string().optional(),
  substituteName: z.string().optional(),
  /** 비상 연락처 */
  emergencyContact: z.string().optional(),
});

export type LeaveForm = z.infer<typeof leaveFormSchema>;

export const approvalRecipientSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.enum(['user', 'dept', 'drafter']),
});
export type ApprovalRecipient = z.infer<typeof approvalRecipientSchema>;

export const documentExecutionSnapshotSchema = z.object({
  executionId: z.string(),
  deptId: z.string(),
  deptName: z.string(),
});
export type DocumentExecutionSnapshot = z.infer<typeof documentExecutionSnapshotSchema>;

export const approvalExecutionSchema = z.object({
  /** 대상 결재문서 ID */
  docId: z.string(),
  /** 기안 시 지정된 시행 대상 유형 ('USER' | 'DEPT') */
  targetType: z.enum(['USER', 'DEPT']),
  /** 시행 대상 ID (사용자 ID 또는 부서 ID) */
  targetId: z.string(),
  /** 시행 처리 상태 */
  status: z.enum(['대기중', '처리중', '시행완료']),
  /** 실제 처리를 담당한 사용자 ID */
  executorId: z.string().nullable().optional(),
  /** 처리 시작 일시 (ISO String) */
  startedAt: z.string().nullable().optional(),
  /** 시행 완료 일자 (YYYY-MM-DD) */
  completedAt: z.string().nullable().optional(),
  /** 시행 처리 의견 */
  comment: z.string().optional().default(''),
});
export type ApprovalExecution = z.infer<typeof approvalExecutionSchema>;

export const relatedDocSchema = z.object({
  /** 대상 기결재 문서 ID (PK) */
  docId: z.string().min(1),
  /** 문서 번호 (AP-YYMMDD-NNN) */
  docNo: z.string().min(1),
  /** 문서 제목 */
  title: z.string(),
  /** 문서 서식/유형 */
  docType: z.string(),
  /** 기안자 성명 (+직급) */
  drafterName: z.string(),
  /** 기안 부서 */
  drafterDept: z.string(),
  /** 결재 완료 일자 (ISO 또는 YYYY-MM-DD) */
  completedAt: z.string().nullable().optional(),
});
export type RelatedDoc = z.infer<typeof relatedDocSchema>;

export const approvalDocSchema = z.object({
  /** 문서 ID(PK) = docNo. */
  id: z.string().min(1),
  /** 문서번호 `AP-YYMMDD-NNN`(counters 채번). */
  docNo: z.string().min(1),
  /** 문서유형 = 결재서식 code(자유 문자열). 기본 4종은 DOC_TYPES 값과 동일. */
  docType: z.string().min(1),
  title: z.string().min(1, '제목은 필수입니다'),
  /** 기안자·기안부서(비정규화 — 목록 표시 성능). */
  drafterId: z.string().min(1),
  drafterDept: z.string().default(''),
  drafterDeptId: z.string().optional().default(''),
  status: z.enum(DOC_STATUS).default('임시저장'),
  /** 결재선(임베드, §5.2). */
  steps: z.array(approvalStepSchema).default([]),
  /** 금액(지출결의·품의) → 결재 규칙 매칭 키. */
  amount: z.number().nullable().default(null),
  /** 본문. */
  body: z.string().default(''),
  /** 기안 당시 기안자 서명 이미지 URL (스냅샷) */
  drafterSignUrl: z.string().nullable().optional(),
  /** 기안 당시 기안자 도장 이미지 URL (스냅샷) */
  drafterSealUrl: z.string().nullable().optional(),
  /** 기안 당시 기안자 서명 유형 (스냅샷) */
  drafterSignType: z.string().nullable().optional(),
  /** 기안 당시 기안자 성명 (스냅샷) */
  drafterName: z.string().nullable().optional(),
  /** 기안 당시 기안자 직급 (스냅샷) */
  drafterPos: z.string().nullable().optional(),
  /** 상신 당시 기안자 직책 (스냅샷) */
  drafterTitle: z.string().nullable().optional(),
  /** 결재란 칭호 방식 — 'jobTitle' 이면 직책 우선(이 기능 이후 만든 문서). 없으면 예전처럼 직급 */
  titleMode: z.string().nullable().optional(),
  /** 유형 확장 필드(휴가=기간·종류 등). 유형별 optional. 휴가 system 서식 전용. */
  form: leaveFormSchema.nullable().default(null),
  /** 결재서식 동적 필드값 `{ key: value }`. 커스텀 서식·확장 필드 저장(휴가 form 은 별도). */
  fieldValues: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).default({}),
  /** 첨부 파일 리스트 */
  attachments: z.array(z.object({
    name: z.string(), // 원본 파일명
    url: z.string(),  // 다운로드 URL
  })).default([]),
  /** 수신(시행)처 목록 */
  recipients: z.array(approvalRecipientSchema).default([]),
  /** 시행 정보 데이터 (시행자가 지정되었을 때만 존재) */
  execution: approvalExecutionSchema.nullable().optional(),
  /** 복수 시행처 목록 Snapshot */
  executionsSnapshot: z.array(documentExecutionSnapshotSchema).optional().default([]),
  /** 실제 집행할 시행 부서 목록 (수신처와 분리) */
  executionDepts: z.array(z.object({
    id: z.string(),
    name: z.string(),
  })).optional().default([]),
  /** 보존연한 설정 */
  preservationPeriod: z.string().nullable().optional(),
  /** 문서 보안 등급 ('일반' | '대외비' | '극비') */
  securityLevel: z.enum(DOC_SECURITY_LEVELS).default('일반'),
  /** 문서 공개 범위 ('부서' | '비공개') */
  visibility: z.enum(['부서', '비공개']).optional().default('부서'),
  /** 연결된 관련 기결재 문서 리스트 */
  relatedDocs: z.array(relatedDocSchema).default([]),
  /** 긴급 선조치 사후 승인(후결) 여부 */
  isPostApproval: z.boolean().default(false),
  /** 후결 - 긴급 사유 (종합) */
  postApprovalReason: z.string().nullable().optional(),
  /** 후결 1. 선조치(긴급 조치) 내용 및 결과 */
  postApprovalActionTaken: z.string().nullable().optional(),
  /** 후결 2. 긴급성 및 불가피성 소명 (Why?) */
  postApprovalNecessity: z.string().nullable().optional(),
  /** 후결 3. 소요 비용 및 내역 */
  postApprovalCostDetails: z.string().nullable().optional(),
  /** 후결 4. 후속 조치 및 재발 방지 대책 */
  postApprovalFollowup: z.string().nullable().optional(),
  /** 후결 - 선조치 일시 (ISO String) */
  postApprovedAt: z.string().nullable().optional(),
  /** 후결 - 선조치 구두/임시 승인자 ID */
  postApprovedById: z.string().nullable().optional(),
  /** 후결 - 선조치 구두/임시 승인자 성명 (스냅샷) */
  postApprovedByName: z.string().nullable().optional(),
  /** 현재 활성 단계 seq(도출 캐시, 목록 성능용). 종결이면 마지막 seq. */
  currentSeq: z.number().default(0),
  createdAt: z.string().nullable().default(null),
  submittedAt: z.string().nullable().default(null),
  completedAt: z.string().nullable().default(null),
  /** 취소 결재 관련 메타데이터 */
  /** 본 취소 기안문이 취소하려는 원문서 ID */
  cancelTargetDocId: z.string().nullable().optional(),
  /** 원문서 관점: 현재 진행 중인 취소 기안 문서 ID (중복 상신 락) */
  cancelDraftId: z.string().nullable().optional(),
  /** 원문서 관점: 최종 취소를 승인 완료한 취소 기안 문서 ID */
  cancelledByDocId: z.string().nullable().optional(),
  /** 원문서 관점: 취소 승인 완료 일시 (ISO string) */
  cancelledAt: z.string().nullable().optional(),
  /** 결재 진행 중 회수 관련 메타데이터 */
  recallReason: z.string().nullable().optional().default(null),
  recalledAt: z.string().nullable().optional().default(null),
  recalledBy: z.string().nullable().optional().default(null),
  /** 회사 — 'lumefab'(루미팹)이면 루미팹 문서(문서번호 LF-). 없으면 워크핏 */
  company: z.enum(['lumefab']).nullable().optional(),
});

export type ApprovalDoc = z.infer<typeof approvalDocSchema>;

/** 결재함 탭(§7.2). 받은결재(대기)·상신함·완료함·수신함·참조함·임시저장·후열함. */
export const APPROVAL_BOXES = ['대기', '상신', '반려', '임시', '수신', '참조', '후열', '완료', '삭제'] as const;
export type ApprovalBox = (typeof APPROVAL_BOXES)[number];
