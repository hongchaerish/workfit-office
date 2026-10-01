import type { ApprovalBox, ApprovalDoc, ApprovalRecipient, ApprovalStep, StepDecision } from './schema';

/**
 * 전자결재 상태전이 엔진 — **순수함수**. UI·DB 를 전혀 모른다.
 *
 * 모든 함수는 입력 문서를 변형하지 않고(불변) **새 문서**를 돌려준다.
 * 시각은 인자(`at`, ISO 문자열)로 주입 — 엔진 내부에서 Date.now 를 쓰지 않아
 * 테스트 재현성과 순수성을 확보한다([[data-layer-pattern]] 파생/순수 원칙).
 * repo·훅이 이 함수를 호출하고, 저장·캐시 무효화만 담당한다.
 * (docs/전자결재_워크플로_개발_계획서.md §4.4 상태머신 · §6 엔진 순수성)
 *
 * 규칙 요약:
 * - 참조(kind='참조')는 열람만 — 진행을 막지 않고 항상 통과 처리.
 * - 순차는 seq 오름차순, 병렬(합의)은 같은 parallelGroup 이 **동시 활성**·전원 승인해야 통과.
 * - 전결(kind='전결') 승인 시 상위 잔여 단계를 생략하고 즉시 완료.
 * - 결정은 **오직 현재 활성 그룹의 본인 차례**에서만.
 */

/** 진행을 막는(=승인이 필요한) 노드인가. 참조만 비차단. */
export function isBlocking(step: ApprovalStep): boolean {
  return step.kind !== '참조';
}

/** 결재선을 실행 그룹으로 분해 — 병렬 그룹은 하나로 묶고, 나머지는 단독. */
interface StepGroup {
  order: number; // 그룹 정렬 기준 = 소속 노드 최소 seq
  members: ApprovalStep[]; // 차단 노드만(참조 제외)
}

function groupsOf(doc: ApprovalDoc): StepGroup[] {
  const blocking = doc.steps.filter(isBlocking);
  const byTag = new Map<string, ApprovalStep[]>();
  for (const s of blocking) {
    // 병렬 그룹 태그가 있으면 태그로, 없으면 seq 를 고유 키로.
    const key = s.parallelGroup ?? `__seq_${s.seq}`;
    const arr = byTag.get(key) ?? [];
    arr.push(s);
    byTag.set(key, arr);
  }
  const groups: StepGroup[] = [...byTag.values()].map((members) => ({
    order: Math.min(...members.map((m) => m.seq)),
    members,
  }));
  return groups.sort((a, b) => a.order - b.order);
}

/** 그룹이 통과됐는가 = 모든 차단 노드가 '승인'. */
const isGroupPassed = (g: StepGroup) => g.members.every((m) => m.decision === '승인');

/** 현재 활성 그룹(아직 통과되지 않은 첫 그룹). 없으면 null(모두 통과=완료 가능). */
function activeGroup(doc: ApprovalDoc): StepGroup | null {
  return groupsOf(doc).find((g) => !isGroupPassed(g)) ?? null;
}

/** 지금 결정 가능한(내 차례) 노드 목록 — 활성 그룹의 '대기'/'보류' 차단 노드. */
export function activeSteps(doc: ApprovalDoc): ApprovalStep[] {
  if (doc.status !== '진행중') return [];
  const g = activeGroup(doc);
  if (!g) return [];
  return g.members.filter((m) => m.decision === '대기' || m.decision === '보류');
}

/** 특정 사용자가 지금 결재할 차례인가(대결 위임 대상 포함은 repo 판단). */
export function isActiveApprover(doc: ApprovalDoc, userId: string): boolean {
  return activeSteps(doc).some((s) => s.approverId === userId);
}

/** 현재 활성 결재자 id 목록(도크 대기 배지·목록 "현재 결재자" 도출). */
export function currentApproverIds(doc: ApprovalDoc): string[] {
  return activeSteps(doc).map((s) => s.approverId);
}

/** 활성 그룹 order 로 currentSeq(도출 캐시) 재계산. 종결이면 마지막 seq. */
function recomputeCurrentSeq(doc: ApprovalDoc): number {
  const g = activeGroup(doc);
  if (g) return g.order;
  const maxSeq = doc.steps.reduce((m, s) => Math.max(m, s.seq), 0);
  return maxSeq;
}

/** steps 의 특정 seq 노드를 patch 로 갱신한 새 배열. */
function patchStep(steps: ApprovalStep[], seq: number, patch: Partial<ApprovalStep>): ApprovalStep[] {
  return steps.map((s) => (s.seq === seq ? { ...s, ...patch } : s));
}

export interface DecisionOptions {
  /** 결정 시각(ISO). */
  at: string;
  /** 의견(반려 시 필수). */
  comment?: string;
  /** 대결 위임 시 원 결재자 id — 이 노드를 대리 승인한 기록. */
  delegatedFromId?: string;
}

export class ApprovalError extends Error {}

/**
 * 결재 결정 적용 — 활성 그룹의 특정 노드에 승인/반려/보류를 반영하고 상태를 전이한다.
 * 반환: 새 문서. 규칙 위반이면 ApprovalError.
 */
export function applyDecision(
  doc: ApprovalDoc,
  seq: number,
  decision: Exclude<StepDecision, '대기'>,
  opts: DecisionOptions,
): ApprovalDoc {
  if (doc.status !== '진행중') throw new ApprovalError('진행중 문서만 결재할 수 있습니다');

  const step = doc.steps.find((s) => s.seq === seq);
  if (!step) throw new ApprovalError('결재선 노드를 찾을 수 없습니다');
  if (!isBlocking(step)) throw new ApprovalError('참조 노드는 결재 대상이 아닙니다');

  const active = activeSteps(doc);
  if (!active.some((s) => s.seq === seq)) throw new ApprovalError('아직 결재할 차례가 아닙니다');
  if (decision === '반려' && !(opts.comment ?? '').trim()) {
    throw new ApprovalError('반려 사유(의견)는 필수입니다');
  }

  const patched = patchStep(doc.steps, seq, {
    decision,
    decidedAt: opts.at,
    comment: opts.comment ?? step.comment,
    delegatedFromId: opts.delegatedFromId ?? step.delegatedFromId,
  });
  let next: ApprovalDoc = { ...doc, steps: patched };

  // 반려 → 종결(반려). 기안자에게 회송. (후결 문서 시 '긴급 조치 사후 검토 반려' 특수 상태 지정)
  if (decision === '반려') {
    const nextStatus = doc.isPostApproval ? '긴급 조치 사후 검토 반려' : '반려';
    return { ...next, status: nextStatus, currentSeq: seq };
  }
  // 보류 → 진행 일시정지(그룹 미통과 유지). 상태는 진행중.
  if (decision === '보류') {
    return { ...next, currentSeq: recomputeCurrentSeq(next) };
  }

  // 승인 (시행처 비활성화로 인해 hasExecution 여부에 무관하게 항상 완료 종결)
  const finalStatus = '완료';
  const completedAtVal = opts.at;

  // 전결 승인 → 상위 잔여 단계 생략하고 즉시 완료.
  if (step.kind === '전결') {
    next = { ...next, status: finalStatus, completedAt: completedAtVal, currentSeq: seq };
  } else {
    // 활성 그룹이 전원 승인됐는지 확인 → 다음 그룹으로 진행 또는 완료.
    const stillActive = activeGroup(next);
    if (!stillActive) {
      // 마지막 그룹 통과 → 완료.
      next = { ...next, status: finalStatus, completedAt: completedAtVal };
    }
  }

  return { ...next, currentSeq: recomputeCurrentSeq(next) };
}

/**
 * 상신/재상신 — 임시저장|반려|회수 → 진행중. 결재선에 차단 노드 1개 이상 필요.
 * 재상신 시 이전 라운드의 결정을 초기화(대기)해 새 결재 라운드를 시작한다.
 */
export function submit(doc: ApprovalDoc, at: string): ApprovalDoc {
  if (!['임시저장', '반려', '긴급 조치 사후 검토 반려', '회수', '시행반송'].includes(doc.status)) {
    throw new ApprovalError('임시저장·반려·회수 상태에서만 상신할 수 있습니다');
  }
  if (!doc.steps.some(isBlocking)) throw new ApprovalError('결재자를 1명 이상 지정하세요');

  const steps = doc.steps.map((s) => ({ ...s, decision: '대기' as StepDecision, decidedAt: null, comment: '' }));
  const fresh: ApprovalDoc = {
    ...doc,
    steps,
    status: '진행중',
    submittedAt: at,
    completedAt: null,
  };
  return { ...fresh, currentSeq: recomputeCurrentSeq(fresh) };
}

/**
 * 결재함 분류(§7.2) — 문서가 userId 관점에서 특정 함(box)에 속하는가. 순수 도출.
 * repo(서버측 필터)와 features(클라 도출)가 **공유**해 단일 진실을 유지한다.
 */
/** 대기함 판정: 진행중이고 내가 결재선에 포함되어 있는 모든 문서 (내 차례 대기중 + 이전/다음 단계 진행중) */
export function isTodoBoxMatch(doc: ApprovalDoc, userId: string, absentApproverIds?: string[]): boolean {
  if (doc.status !== '진행중') return false;
  
  // 1. 내가 결재선에 포함되어 있는가 (결재자 또는 대결자, 참조 제외)
  const isInChain = doc.steps.some(
    (s) => s.kind !== '참조' && (s.approverId === userId || s.delegatedFromId === userId)
  );
  if (isInChain) return true;
  
  // 2. 부재자 대결 위임으로 내게 차례가 온 경우
  if (absentApproverIds && absentApproverIds.length > 0) {
    const activeIds = currentApproverIds(doc);
    return activeIds.some((id) => absentApproverIds.includes(id));
  }
  return false;
}

/** 상신함 판정: 내가 기안자이고 상신된 모든 문서(진행중, 반려, 완료, 회수 등 / 임시저장·삭제 제외) */
export function isDrafterBoxMatch(doc: ApprovalDoc, userId: string): boolean {
  if (doc.drafterId !== userId) return false;
  return doc.status !== '임시저장' && doc.status !== '삭제';
}

/** 반려함 판정: 결재권자 관점에서 본인이 직접 반려 처리했거나, 결재선(검토/승인/전결)에 참여했던 반려 문서 */
export function isRejectedBoxMatch(doc: ApprovalDoc, userId: string): boolean {
  const isRejectedStatus = doc.status === '반려' || doc.status === '긴급 조치 사후 검토 반려' || doc.status === '시행반송';
  if (!isRejectedStatus) return false;
  const isMyRejectedDecision = doc.steps.some((s) => (s.approverId === userId || s.delegatedFromId === userId) && s.decision === '반려');
  const isInApprovalChain = doc.steps.some((s) => s.approverId === userId || s.delegatedFromId === userId);
  return isMyRejectedDecision || isInApprovalChain;
}

const REJECTED_READ_STORAGE_PREFIX = 'workfit_read_rejected_docs:';

/** 사용자가 열람한 반려 문서 ID 세트 조회 */
export function getReadRejectedDocIds(userId: string): Set<string> {
  if (!userId || typeof window === 'undefined') return new Set();
  try {
    const raw = localStorage.getItem(`${REJECTED_READ_STORAGE_PREFIX}${userId}`);
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch {
    return new Set();
  }
}

/** 반려 문서 열람 처리 (읽음 기록) */
export function markRejectedDocAsRead(userId: string, docId: string): void {
  if (!userId || !docId || typeof window === 'undefined') return;
  try {
    const set = getReadRejectedDocIds(userId);
    if (!set.has(docId)) {
      set.add(docId);
      localStorage.setItem(`${REJECTED_READ_STORAGE_PREFIX}${userId}`, JSON.stringify(Array.from(set)));
    }
  } catch {}
}

/** 레거시 시행처(executionDepts, execution)까지 포함한 수신처(recipients) 유효 목록 도출 */
export function getEffectiveRecipients(doc: ApprovalDoc): ApprovalRecipient[] {
  const list: ApprovalRecipient[] = [...(doc.recipients || [])];
  const seenIds = new Set(list.map((r) => r.id));

  // 1. 레거시 executionDepts 수신처로 정규화
  if (doc.executionDepts && doc.executionDepts.length > 0) {
    for (const d of doc.executionDepts) {
      if (d.id && !seenIds.has(d.id)) {
        seenIds.add(d.id);
        list.push({ id: d.id, name: d.name, type: 'dept' });
      }
    }
  }

  // 2. 레거시 단일 execution 수신처로 정규화
  if (doc.execution && doc.execution.targetId) {
    const tid = doc.execution.targetId;
    if (!seenIds.has(tid)) {
      seenIds.add(tid);
      const type = doc.execution.targetType === 'USER' ? 'user' : 'dept';
      list.push({ id: tid, name: tid, type });
    }
  }

  return list;
}

/** 수신함 판정: 완료(및 레거시 시행대기, 취소완료)된 문서 중 특정 자격(수신처 지정 등)이 매칭되는 문서 (레거시 시행처 포함) */
export function isReceivedBoxMatch(doc: ApprovalDoc, userId: string, userDeptName?: string): boolean {
  if (doc.status !== '완료' && doc.status !== '시행대기' && doc.status !== '취소완료') return false;
  const isExecutorDrafter = doc.drafterId === userId && ['외근', '국내출장', '해외출장', '인장날인', '공문발송'].includes(doc.docType);
  const effectiveRecipients = getEffectiveRecipients(doc);
  const isCustomRecipient = effectiveRecipients.some((r) => {
    if (r.type === 'user') return r.id === userId;
    if (r.type === 'dept' && userDeptName) {
      const parts = userDeptName.split('||');
      return parts.includes(r.name) || parts.includes(r.id);
    }
    if (r.type === 'drafter') return doc.drafterId === userId;
    return false;
  });
  return isExecutorDrafter || isCustomRecipient;
}

/** 완료함 판정: 최종 완료된 문서(및 레거시 시행대기, 취소완료 문서) 중 내가 기안했거나 승인 결재한 문서 */
export function isCompletedBoxMatch(doc: ApprovalDoc, userId: string): boolean {
  if (doc.status !== '완료' && doc.status !== '시행대기' && doc.status !== '취소완료') return false;
  
  const isMyDraft = doc.drafterId === userId;
  const isMyApproved = doc.steps.some((s) => s.approverId === userId && s.decision === '승인');
  return isMyDraft || isMyApproved;
}

/**
 * 결재함 분류(§7.2) — 문서가 userId 관점에서 특정 함(box)에 속하는가. 순수 도출.
 * repo(서버측 필터)와 features(클라 도출)가 **공유**해 단일 진실을 유지한다.
 */
export function matchesBox(
  doc: ApprovalDoc,
  userId: string,
  box: ApprovalBox,
  userDeptName?: string,
  absentApproverIds?: string[],
  /** userId 가 후열(공람) 전달받은 문서 id 집합. 넘기지 않으면 대결 원결재자 건만 후열로 본다. */
  postReadDocIds?: ReadonlySet<string>
): boolean {
  if (doc.status === '삭제') {
    return box === '삭제' && doc.drafterId === userId;
  }
  switch (box) {
    case '대기':   return isTodoBoxMatch(doc, userId, absentApproverIds);
    case '상신':   return isDrafterBoxMatch(doc, userId);
    case '반려':   return isRejectedBoxMatch(doc, userId);
    case '임시':   return doc.drafterId === userId && doc.status === '임시저장';
    case '수신':   return isReceivedBoxMatch(doc, userId, userDeptName);
    case '참조':   return doc.status !== '임시저장' && doc.steps.some((s) => s.kind === '참조' && s.approverId === userId);
    case '후열':
      return (doc.status === '완료' || doc.status === '시행대기' || doc.status === '취소완료')
        && (doc.steps.some((s) => s.delegatedFromId === userId) || postReadDocIds?.has(doc.id) === true);
    case '완료':   return isCompletedBoxMatch(doc, userId);
    case '삭제':   return false;
  }
  return false;
}




/** 목록 정렬 기준(최근 상신/생성 우선). */
export function byRecent(a: ApprovalDoc, b: ApprovalDoc): number {
  return (b.submittedAt ?? b.createdAt ?? '').localeCompare(a.submittedAt ?? a.createdAt ?? '');
}

/** 회수 — 진행중 문서를 기안자가 상신 취소. 중간 결재자가 승인한 경우 사유 입력 기반으로 회수 허용. */
export function recall(
  doc: ApprovalDoc,
  options?: { reason?: string | null; userId?: string | null; allowMidRecall?: boolean },
): ApprovalDoc {
  if (doc.status !== '진행중') throw new ApprovalError('진행중 문서만 회수할 수 있습니다');
  const anyApproved = doc.steps.filter(isBlocking).some((s) => s.decision === '승인');
  if (anyApproved && !options?.allowMidRecall) {
    throw new ApprovalError('이미 승인이 진행돼 회수할 수 없습니다');
  }
  const now = new Date().toISOString();
  return {
    ...doc,
    status: '회수',
    currentSeq: 0,
    recallReason: options?.reason ?? doc.recallReason ?? null,
    recalledAt: now,
    recalledBy: options?.userId ?? doc.recalledBy ?? null,
  };
}

// ── 후임자 업무/권한 승계 판별 헬퍼 ──
// (인사이동 대응: 동적 successionRepo 연동으로 변경)
import { successionRepo } from '@/data/succession/succession.repo';

/** 특정 후임자 ID가 인계받은 전임자(들)의 ID 리스트를 리턴합니다. */
export function getPredecessorsOf(successorId: string): string[] {
  if (!successorId) return [];
  return successionRepo.getPredecessorsOf(successorId);
}

/** 특정 전임자 ID의 다음 후임자 ID를 리턴합니다. */
export function getSuccessorOf(predecessorId: string): string | null {
  if (!predecessorId) return null;
  return successionRepo.getSuccessorOf(predecessorId);
}


