import { collection, deleteDoc, doc, getDocs, setDoc, query, onSnapshot, type QuerySnapshot } from 'firebase/firestore';
import { db } from '@/shared/lib/firebase';
import { client as appwriteClient, databases, APPWRITE_DATABASE_ID, Query, assertAppwriteId } from '@/shared/lib/appwrite';
import { dbDriver } from '@/shared/lib/dbDriver';
import {
  approvalDocSchema,
  type ApprovalBox,
  type ApprovalDoc,
  type ApprovalStep,
} from '@/domain/approvalDoc/schema';
import {
  applyDecision,
  byRecent,
  isActiveApprover,
  activeSteps,
  matchesBox,
  recall as recallDoc,
  submit as submitDoc,
  currentApproverIds,
} from '@/domain/approvalDoc/engine';
import { formatDocNo, yymmdd } from '@/domain/numbering';
import { counterRepo } from '@/data/counter/counter.repo';
import { APPROVAL_DOC_SEED } from '@/data/seeds/approvalDoc.seed';
import { userRepo } from '@/data/user/user.repo';
import { departmentRepo } from '@/data/department/department.repo';
import { absenceRepo } from '@/data/absence/absence.repo';
import { approvalProcessRepo } from '@/data/approvalProcess/approvalProcess.repo';
import { approvalPostReadRepo } from '@/data/approvalPostRead/approvalPostRead.repo';
import { postReadDocIdsFor } from '@/domain/approvalPostRead/engine';

/**
 * 전자결재 문서 Repository — 채번(counters) + **순수 엔진**(domain/approvalDoc/engine)
 * 을 호출해 상태전이를 강제한다. 권한(활성 단계 결재자·기안자)도 여기서 검증한다.
 * ([[DB_이관_대비_설계원칙.md]] 원칙 1 / [[data-layer-pattern]] 상태머신+채번 패턴)
 *
 * steps 는 배열-of-맵이라 Firestore 중첩배열 제약에 걸리지 않아 코덱이 불필요하다.
 * Firebase 미설정이면 in-memory seed 로 graceful degrade.
 */
const COLL = 'approvalDocs';

function migrateDoc(data: any): any {
  if (!data) return data;
  let form = data.form;
  if (data.docType !== '휴가' || !form || !form.leaveType) {
    form = null;
  }
  let status = data.status;
  if (status === '시행반송') {
    status = '반려';
  } else if (status === '시행대기') {
    status = '완료';
  }
  return {
    ...data,
    status,
    form,
    attachments: data.attachments ?? [],
    execution: data.execution ?? null,
    executionsSnapshot: data.executionsSnapshot ?? [],
    executionDepts: data.executionDepts ?? [],
    preservationPeriod: data.preservationPeriod ?? null,
    relatedDocs: data.relatedDocs ?? [],
    visibility: data.visibility === '전사' ? '부서' : (data.visibility ?? '부서'),
    isPostApproval: data.isPostApproval ?? false,
    postApprovalReason: data.postApprovalReason ?? null,
    postApprovalActionTaken: data.postApprovalActionTaken ?? null,
    postApprovalNecessity: data.postApprovalNecessity ?? null,
    postApprovalCostDetails: data.postApprovalCostDetails ?? null,
    postApprovalFollowup: data.postApprovalFollowup ?? null,
    postApprovedAt: data.postApprovedAt ?? null,
    postApprovedById: data.postApprovedById ?? null,
    postApprovedByName: data.postApprovedByName ?? null,
    cancelTargetDocId: data.cancelTargetDocId ?? null,
    cancelDraftId: data.cancelDraftId ?? null,
    cancelledByDocId: data.cancelledByDocId ?? null,
    cancelledAt: data.cancelledAt ?? null,
    steps: Array.isArray(data.steps) ? data.steps.map((s: any) => ({
      ...s,
      kind: s.kind,
    })) : [],
  };
}

// ─────────────────────────────────────────────────────────────
// 저장 백엔드 어댑터 (VITE_DB_DRIVER) — DB 접근 격리.
// Appwrite: 필드 40여개·깊은 중첩이라 **전체 문서를 payload(JSON) 통짜 저장**
// + 쿼리/표시용 스칼라 컬럼(docNo·drafterId·status·docType·title·drafterName).
// ─────────────────────────────────────────────────────────────
interface ApprovalDocBackend {
  loadAll(): Promise<ApprovalDoc[]>;
  persist(item: ApprovalDoc): Promise<void>;
  remove(id: string): Promise<void>;
  subscribe(callback: (docs: ApprovalDoc[]) => void): () => void;
}

/** 저장소 무관 파싱 — migrateDoc(하위호환) 적용 후 안전 파싱, 불량은 건너뜀. */
function parseDoc(raw: unknown): ApprovalDoc | null {
  try {
    return approvalDocSchema.parse(migrateDoc(raw));
  } catch (err) {
    console.error('Failed to parse approval document:', err);
    return null;
  }
}

class MemoryBackend implements ApprovalDocBackend {
  private rows: ApprovalDoc[] = APPROVAL_DOC_SEED.map((d) => approvalDocSchema.parse(migrateDoc(d)));
  private listeners = new Set<() => void>();
  private notify() {
    this.listeners.forEach((l) => l());
  }
  async loadAll() {
    return this.rows;
  }
  async persist(item: ApprovalDoc) {
    const i = this.rows.findIndex((m) => m.id === item.id);
    if (i >= 0) this.rows[i] = item;
    else this.rows = [item, ...this.rows];
    this.notify();
  }
  async remove(id: string) {
    this.rows = this.rows.filter((m) => m.id !== id);
    this.notify();
  }
  subscribe(cb: (docs: ApprovalDoc[]) => void) {
    const l = () => cb(this.rows);
    this.listeners.add(l);
    l();
    return () => {
      this.listeners.delete(l);
    };
  }
}

class FirestoreBackend implements ApprovalDocBackend {
  async loadAll() {
    const snap = await getDocs(collection(db!, COLL));
    const out: ApprovalDoc[] = [];
    for (const d of snap.docs) {
      const m = parseDoc(d.data());
      if (m) out.push(m);
    }
    return out;
  }
  async persist(item: ApprovalDoc) {
    await setDoc(doc(db!, COLL, item.id), item);
  }
  async remove(id: string) {
    await deleteDoc(doc(db!, COLL, id));
  }
  subscribe(cb: (docs: ApprovalDoc[]) => void) {
    return onSnapshot(
      query(collection(db!, COLL)),
      (snap: QuerySnapshot) => {
        const out: ApprovalDoc[] = [];
        for (const d of snap.docs) {
          const m = parseDoc(d.data());
          if (m) out.push(m);
        }
        cb(out);
      },
      (err: Error) => {
        console.warn('Firestore approvalDocs subscription failed:', err);
        cb([]);
      },
    );
  }
}

type ApRow = Record<string, unknown> & { $id: string; payload?: string };
class AppwriteBackend implements ApprovalDocBackend {
  private get dbs() {
    return databases!;
  }
  private toAttrs(d: ApprovalDoc): Record<string, unknown> {
    return {
      id: d.id,
      docNo: d.docNo,
      docType: d.docType,
      title: d.title,
      drafterId: d.drafterId,
      status: d.status,
      drafterName: d.drafterName ?? null,
      payload: JSON.stringify(d), // 전체 문서(SSOT)
    };
  }
  private fromRow(row: ApRow): ApprovalDoc | null {
    if (!row.payload) return null;
    try {
      return parseDoc(JSON.parse(row.payload));
    } catch (err) {
      console.error('Failed to parse approval document payload JSON:', err);
      return null;
    }
  }
  async loadAll() {
    const out: ApprovalDoc[] = [];
    const PAGE = 100;
    for (let offset = 0; ; offset += PAGE) {
      const res = await this.dbs.listDocuments(APPWRITE_DATABASE_ID, COLL, [Query.limit(PAGE), Query.offset(offset)]);
      for (const row of res.documents as unknown as ApRow[]) {
        const m = this.fromRow(row);
        if (m) out.push(m);
      }
      if (res.documents.length < PAGE) break;
    }
    return out;
  }
  async persist(item: ApprovalDoc) {
    const id = assertAppwriteId(item.id);
    const attrs = this.toAttrs(item);
    try {
      await this.dbs.updateDocument(APPWRITE_DATABASE_ID, COLL, id, attrs);
    } catch (e) {
      if ((e as { code?: number })?.code === 404) {
        await this.dbs.createDocument(APPWRITE_DATABASE_ID, COLL, id, attrs);
      } else {
        throw e;
      }
    }
  }
  async remove(id: string) {
    await this.dbs.deleteDocument(APPWRITE_DATABASE_ID, COLL, id);
  }
  subscribe(cb: (docs: ApprovalDoc[]) => void) {
    void this.loadAll().then(cb); // 초기 1회
    const dbId = APPWRITE_DATABASE_ID;
    const channels = [`databases.${dbId}.collections.${COLL}.documents`, `databases.${dbId}.tables.${COLL}.rows`];
    /**
     * 몰려 오는 이벤트를 한 번으로 합친다.
     *
     * 알림과 달리 결재 문서는 사용자별로 가를 수 없다 — 상태가 바뀌면 관련자 모두가
     * 최신 목록을 봐야 한다. 그래서 필터 대신 **합치기**로 부하를 줄인다.
     * 일괄 결재처럼 한꺼번에 수십 건이 바뀌면 예전에는 그 수만큼 전체 재조회가 돌았다.
     */
    let pending: ReturnType<typeof setTimeout> | null = null;
    const unsub = appwriteClient!.subscribe(channels, () => {
      if (pending) clearTimeout(pending);
      pending = setTimeout(() => {
        pending = null;
        void this.loadAll().then(cb);
      }, 150);
    });
    return () => {
      if (pending) clearTimeout(pending);
      unsub();
    };
  }
}

function selectBackend(): ApprovalDocBackend {
  switch (dbDriver) {
    case 'appwrite':
      return new AppwriteBackend();
    case 'firestore':
      return new FirestoreBackend();
    default:
      return new MemoryBackend();
  }
}
const backend: ApprovalDocBackend = selectBackend();

async function loadAll(): Promise<ApprovalDoc[]> {
  return backend.loadAll();
}

async function persist(item: ApprovalDoc): Promise<void> {
  await backend.persist(approvalDocSchema.parse(item));
}

async function getOrThrow(id: string): Promise<ApprovalDoc> {
  const rows = await loadAll();
  const found = rows.find((d) => d.id === id);
  if (!found) throw new Error(`결재 문서를 찾을 수 없습니다: ${id}`);
  return found;
}

const now = () => new Date().toISOString();


/** 동시성 락 및 결재자/대결자 권한 검증. */
async function verifyApproverOrDelegate(
  doc: ApprovalDoc,
  seq: number,
  userId: string
): Promise<{ isDirect: boolean; isDelegate: boolean; originalApproverId: string }> {
  const target = doc.steps.find((s) => s.seq === seq);
  if (!target) {
    throw new Error('결재선 노드를 찾을 수 없습니다.');
  }
  // Concurrency Lock: 이미 승인/반려/처리 완료된 경우
  if (target.decision !== '대기' && target.decision !== '보류') {
    throw new Error('이미 승인되거나 처리된 결재 단계입니다.');
  }
  const isCurrentActive = activeSteps(doc).some((s) => s.seq === seq);
  if (!isCurrentActive) {
    throw new Error('현재 활성 상태인 결재 단계가 아닙니다.');
  }

  // 1. 직접 본인이 결재자인 경우
  if (target.approverId === userId) {
    return { isDirect: true, isDelegate: false, originalApproverId: userId };
  }

  // 2. 본인이 부재 중인 원 결재자의 활성 대결자로 지정되어 있는 경우 (Proxy - 서식 범위 및 금액 제한 검증 포함)
  const isProxyEnabled = await approvalProcessRepo.isOptionEnabled('proxy_approval');
  if (isProxyEnabled) {
    const absenceCheck = await absenceRepo.isCurrentlyAbsent(target.approverId, doc.docType, doc.amount);
    if (absenceCheck.isAbsent && absenceCheck.delegateUserId === userId) {
      return { isDirect: false, isDelegate: true, originalApproverId: target.approverId };
    } else if (absenceCheck.blockReason) {
      throw new Error(`대결 결재 불가: ${absenceCheck.blockReason}`);
    }
  }

  throw new Error('결재 권한이 없습니다 (본인 차례이거나 지정 대결자가 아닙니다).');
}

/** 임시저장 신규 문서 초안(시스템 필드 제외). */
export interface ApprovalDraftInput {
  docType: ApprovalDoc['docType'];
  title: string;
  drafterId: string;
  drafterDept?: string;
  drafterDeptId?: string;
  steps: ApprovalStep[];
  amount?: number | null;
  body?: string;
  form?: ApprovalDoc['form'];
  /** 결재서식 동적 필드값. */
  fieldValues?: ApprovalDoc['fieldValues'];
  /** 첨부 파일 목록 */
  attachments?: ApprovalDoc['attachments'];
  /** 수신(시행)처 목록 */
  recipients?: ApprovalDoc['recipients'];
  /** 보존연한 */
  preservationPeriod?: string | null;
  /** 시행 정보 */
  execution?: ApprovalDoc['execution'];
  /** 시행 부서 목록 */
  executionDepts?: ApprovalDoc['executionDepts'];
  /** 관련 문서 목록 */
  relatedDocs?: ApprovalDoc['relatedDocs'];
  /** 문서 보안 등급 ('일반' | '대외비' | '극비') */
  securityLevel?: '일반' | '대외비' | '극비';
  /** 문서 공개 범위 ('부서' | '비공개') */
  visibility?: '부서' | '비공개';
  /** 긴급 선조치 사후 승인(후결) 여부 */
  isPostApproval?: boolean;
  /** 후결 긴급 사유 (종합) */
  postApprovalReason?: string | null;
  /** 후결 1. 선조치(긴급 조치) 내용 및 결과 */
  postApprovalActionTaken?: string | null;
  /** 후결 2. 긴급성 및 불가피성 소명 (Why?) */
  postApprovalNecessity?: string | null;
  /** 후결 3. 소요 비용 및 내역 */
  postApprovalCostDetails?: string | null;
  /** 후결 4. 후속 조치 및 재발 방지 대책 */
  postApprovalFollowup?: string | null;
  /** 후결 선조치 일시 */
  postApprovedAt?: string | null;
  /** 후결 선조치 승인자 ID */
  postApprovedById?: string | null;
  /** 후결 선조치 승인자 성명 */
  postApprovedByName?: string | null;
  /** 취소 기안 시 대상 원문서 ID */
  cancelTargetDocId?: string | null;
}

/** 취소 기안 문서 최종 승인(완료) 시 대상 원문서를 '취소완료' 상태로 전이 */
async function handleCancelTargetOnComplete(next: ApprovalDoc): Promise<void> {
  if (next.status !== '완료' || !next.cancelTargetDocId) return;
  try {
    const target = await getOrThrow(next.cancelTargetDocId);
    target.status = '취소완료';
    target.cancelledByDocId = next.id;
    target.cancelledAt = next.completedAt ?? now();
    target.cancelDraftId = null;
    await persist(target);

    // 원문서 기안자에게 취소 완료 알림 전송
    try {
      const { notificationRepo } = await import('@/data/notification/notification.repo');
      await notificationRepo.create({
        userId: target.drafterId,
        type: '결재',
        title: '결재 취소 완료',
        text: `[${target.title}] 문서의 취소 결재가 최종 승인되어 해당 문서가 취소 처리되었습니다.`,
        senderName: '전자결재 시스템',
        linkUrl: `/gw/approval?doc=${target.id}`,
      });
    } catch (ne) {
      console.error('취소 완료 알림 전송 실패:', ne);
    }
  } catch (err) {
    console.error('취소 대상 원문서 상태 전이 실패:', err);
  }
}

/** 취소 기안 문서 회수 또는 반려 시 대상 원문서의 cancelDraftId 락 해제 */
async function handleCancelTargetOnAbort(doc: ApprovalDoc): Promise<void> {
  if (!doc.cancelTargetDocId) return;
  try {
    const target = await getOrThrow(doc.cancelTargetDocId);
    if (target.cancelDraftId === doc.id) {
      target.cancelDraftId = null;
      await persist(target);
    }
  } catch (err) {
    console.error('취소 대상 원문서 락 해제 실패:', err);
  }
}

export const approvalDocRepo = {
  /** 전체 조회. */
  async list(): Promise<ApprovalDoc[]> {
    return loadAll();
  },

  async get(id: string): Promise<ApprovalDoc | null> {
    const rows = await loadAll();
    return rows.find((d) => d.id === id) ?? null;
  },

  async getById(id: string): Promise<ApprovalDoc | null> {
    return this.get(id);
  },

  /**
   * 결재함별 조회(§7.2). userId 관점의 5개 탭.
   * - 대기: 진행중 + 내가 현재 활성 결재자
   * - 상신: 내가 기안(임시 제외, 진행/완료/반려/회수)
   * - 완료: 내가 관여(기안 또는 결재자)한 완료 문서
   * - 참조: 내가 참조(kind='참조')로 지정된 문서
   * - 임시: 내 임시저장
   */
  async listByBox(userId: string, box: ApprovalBox): Promise<ApprovalDoc[]> {
    const rows = await loadAll();
    const users = await userRepo.list();
    const user = users.find((u) => u.id === userId);
    
    const depts = await departmentRepo.list();
    const userDeptObj = depts.find((d) => d.name === user?.dept);
    const userDeptNameOrId = userDeptObj ? `${user?.dept}||${userDeptObj.id}` : user?.dept;

    // 대기함 조회 시: 본인을 대결자로 지정해둔 활성 부재자 ID 목록 도출 (Dual-Routing - 서식 범위 검증 포함)
    const isProxyEnabled = await approvalProcessRepo.isOptionEnabled('proxy_approval');
    if (box === '대기' && isProxyEnabled) {
      const allAbsences = await Promise.all(users.map((u) => absenceRepo.get(u.id)));
      const now = new Date();

      return rows
        .filter((d) => {
          const docAbsentApproverIds = allAbsences
            .filter((cfg) => {
              if (!cfg.isAbsent || cfg.delegateUserId !== userId) return false;
              if (cfg.startDate && now < new Date(cfg.startDate)) return false;
              if (cfg.endDate && now > new Date(cfg.endDate)) return false;
              // 서식 범위 검증
              if (cfg.scope === 'SPECIFIC_FORMS' && (!cfg.allowedDocTypes || !cfg.allowedDocTypes.includes(d.docType))) {
                return false;
              }
              // 최고 금액 제한 검증
              if (d.amount != null && cfg.maxDelegateAmount != null && cfg.maxDelegateAmount > 0) {
                if (d.amount > cfg.maxDelegateAmount) return false;
              }
              return true;
            })
            .map((cfg) => cfg.userId);

          return matchesBox(d, userId, box, userDeptNameOrId, docAbsentApproverIds);
        })
        .sort(byRecent);
    }

    const postReadDocIds = box === '후열'
      ? postReadDocIdsFor(await approvalPostReadRepo.listByRecipients([userId]).catch(() => []), userId)
      : undefined;
    return rows.filter((d) => matchesBox(d, userId, box, userDeptNameOrId, undefined, postReadDocIds)).sort(byRecent);
  },

  /** 임시저장 신규 작성 — 채번 + status='임시저장'. */
  async createDraft(input: ApprovalDraftInput): Promise<ApprovalDoc> {
    const dateKey = yymmdd(new Date());
    const seq = await counterRepo.next(`AP-${dateKey}`);
    const docNo = formatDocNo('AP', dateKey, seq);
    const users = await userRepo.list();
    const drafterUser = users.find((u) => u.id === input.drafterId);
    
    const created = approvalDocSchema.parse({
      id: docNo,
      docNo,
      docType: input.docType,
      title: input.title,
      drafterId: input.drafterId,
      drafterDept: input.drafterDept ?? '',
      status: '임시저장',
      steps: input.steps,
      amount: input.amount ?? null,
      body: input.body ?? '',
      form: input.form ?? null,
      fieldValues: input.fieldValues ?? {},
      attachments: input.attachments ?? [],
      recipients: input.recipients ?? [],
      currentSeq: 0,
      createdAt: now(),
      submittedAt: null,
      completedAt: null,
      drafterSignUrl: drafterUser?.signUrl ?? null,
      drafterSealUrl: drafterUser?.sealUrl ?? null,
      drafterSignType: drafterUser?.signType ?? null,
      drafterName: drafterUser?.name ?? null,
      drafterPos: drafterUser?.position ?? null,
      preservationPeriod: input.preservationPeriod ?? null,
      execution: input.execution ?? null,
      executionDepts: input.executionDepts ?? [],
      relatedDocs: input.relatedDocs ?? [],
      securityLevel: input.securityLevel ?? '일반',
      visibility: input.visibility ?? '부서',
      isPostApproval: input.isPostApproval ?? false,
      postApprovalReason: input.postApprovalReason ?? null,
      postApprovalActionTaken: input.postApprovalActionTaken ?? null,
      postApprovalNecessity: input.postApprovalNecessity ?? null,
      postApprovalCostDetails: input.postApprovalCostDetails ?? null,
      postApprovalFollowup: input.postApprovalFollowup ?? null,
      postApprovedAt: input.postApprovedAt ?? null,
      postApprovedById: input.postApprovedById ?? null,
      postApprovedByName: input.postApprovedByName ?? null,
      cancelTargetDocId: input.cancelTargetDocId ?? null,
    });

    await persist(created);
    return created;
  },

  /** 문서 편집 — 임시저장(상신 전) 또는 반려·회수(재상신 전 수정). 진행중·완료는 불가. */
  async saveDraft(id: string, patch: Partial<ApprovalDraftInput>): Promise<ApprovalDoc> {
    const cur = await getOrThrow(id);
    if (!['임시저장', '반려', '긴급 조치 사후 검토 반려', '회수', '시행반송'].includes(cur.status)) {
      throw new Error('임시저장·반려·회수 상태에서만 수정할 수 있습니다');
    }
    const merged = approvalDocSchema.parse({ ...cur, ...patch });
    await persist(merged);
    return merged;
  },

  /** 상신/재상신 — 임시저장|반려|회수 → 진행중(엔진 위임). 기안자만. */
  async submit(id: string, userId: string): Promise<ApprovalDoc> {
    const cur = await getOrThrow(id);
    if (cur.drafterId !== userId) throw new Error('기안자만 상신할 수 있습니다');
    const users = await userRepo.list();
    const drafterUser = users.find((u) => u.id === userId);
    
    const next = submitDoc(cur, now());
    next.drafterSignUrl = drafterUser?.signUrl ?? null;
    next.drafterSealUrl = drafterUser?.sealUrl ?? null;
    next.drafterSignType = drafterUser?.signType ?? null;
    next.drafterName = drafterUser?.name ?? null;
    next.drafterPos = drafterUser?.position ?? null;
    
    // 결재선의 기안 노드(seq === 1)에도 당시의 서명/인장 스냅샷 정보를 박제
    next.steps = next.steps.map((s) => {
      if (s.seq === 1 && s.approverId === userId) {
        return {
          ...s,
          signUrl: drafterUser?.signUrl ?? null,
          sealUrl: drafterUser?.sealUrl ?? null,
          signType: drafterUser?.signType ?? null,
          approverName: drafterUser?.name ?? null,
          approverPos: drafterUser?.position ?? null,
          approverDept: drafterUser?.dept ?? null,
        };
      }
      return s;
    });

    // 취소 기안 상신 시: 대상 원문서 검증 및 cancelDraftId 락 설정
    if (next.cancelTargetDocId) {
      const target = await getOrThrow(next.cancelTargetDocId);
      if (target.cancelledAt || (target.status as string) === '취소완료') {
        throw new Error('이미 취소 처리 완료된 문서입니다.');
      }
      if (target.status !== '완료' && target.status !== '시행대기') {
        throw new Error('결재 완료된 문서만 취소 결재를 상신할 수 있습니다.');
      }
      if (target.cancelDraftId && target.cancelDraftId !== next.id) {
        throw new Error(`이미 다른 취소 결재(${target.cancelDraftId})가 진행 중입니다.`);
      }
      target.cancelDraftId = next.id;
      await persist(target);
    }

    await persist(next);

    // 알림 생성 연동
    try {
      const activeApprovers = currentApproverIds(next);
      const { notificationRepo } = await import('@/data/notification/notification.repo');
      for (const appUserId of activeApprovers) {
        await notificationRepo.create({
          userId: appUserId,
          type: '결재',
          title: '결재 요청',
          text: `[${next.title}] 결재선에 본인의 차례가 되었습니다.`,
          senderName: drafterUser?.name ?? '기안자',
          linkUrl: `/gw/approval?doc=${next.id}`,
        });
      }
    } catch (e) {
      console.error('상신 알림 전송 실패:', e);
    }

    return next;
  },

  /** 승인 — 활성 단계 결재자 또는 대결자 (동시성 락 & 대결 처리). */
  async approve(id: string, seq: number, userId: string, comment = ''): Promise<ApprovalDoc> {
    const cur = await getOrThrow(id);
    const auth = await verifyApproverOrDelegate(cur, seq, userId);

    const users = await userRepo.list();
    const actingUser = users.find((u) => u.id === userId);

    let docToProcess = cur;
    // 대결자인 경우: approverId를 대결자로 교체하고 delegatedFromId에 원결재자 기록
    if (auth.isDelegate) {
      docToProcess = {
        ...cur,
        steps: cur.steps.map((s) =>
          s.seq === seq ? { ...s, approverId: userId, delegatedFromId: auth.originalApproverId } : s
        ),
      };
    }

    const next = applyDecision(docToProcess, seq, '승인', { at: now(), comment });
    next.steps = next.steps.map((s) => {
      if (s.seq === seq && s.approverId === userId) {
        return {
          ...s,
          signUrl: actingUser?.signUrl ?? null,
          sealUrl: actingUser?.sealUrl ?? null,
          signType: actingUser?.signType ?? null,
          approverName: actingUser?.name ?? null,
          approverPos: actingUser?.position ?? null,
          approverDept: actingUser?.dept ?? null,
        };
      }
      return s;
    });

    await persist(next);
    await handleCancelTargetOnComplete(next);

    // 알림 생성 연동
    try {
      const { notificationRepo } = await import('@/data/notification/notification.repo');
      const users = await userRepo.list();
      const approverUser = users.find((u) => u.id === userId);



      if (next.status === '완료') {
        // 기안자에게 완료 알림
        await notificationRepo.create({
          userId: next.drafterId,
          type: '결재',
          title: '결재 완료',
          text: `[${next.title}] 결재가 최종 승인(완료)되었습니다.`,
          senderName: approverUser?.name ?? '결재자',
          linkUrl: `/gw/approval?doc=${next.id}`,
        });

        // 전결자(최종 결재자)에게 완료 알림
        await notificationRepo.create({
          userId: userId,
          type: '결재',
          title: '결재 완료',
          text: `[${next.title}] 문서 결재를 최종 승인(전결) 처리하였습니다.`,
          senderName: '시스템',
          linkUrl: `/gw/approval?doc=${next.id}`,
        });

        // 수신처 알림
        for (const rec of next.recipients || []) {
          if (rec.type === 'user') {
            await notificationRepo.create({
              userId: rec.id,
              type: '결재',
              title: '수신 문서 알림',
              text: `[${next.title}] 수신 문서가 배달되었습니다.`,
              senderName: '시스템',
              linkUrl: `/gw/approval?doc=${next.id}`,
            });
          } else if (rec.type === 'dept') {
            const deptUsers = users.filter((u) => u.dept === rec.name);
            for (const du of deptUsers) {
              await notificationRepo.create({
                userId: du.id,
                type: '결재',
                title: '수신 문서 알림',
                text: `[${next.title}] 부서 수신 문서가 배달되었습니다.`,
                senderName: '시스템',
                linkUrl: `/gw/approval?doc=${next.id}`,
              });
            }
          }
        }
      } else if (next.status === '진행중') {
        // 다음 결재자들에게 알림
        const activeApprovers = currentApproverIds(next);
        for (const appUserId of activeApprovers) {
          await notificationRepo.create({
            userId: appUserId,
            type: '결재',
            title: '결재 요청',
            text: `[${next.title}] 결재선에 본인의 차례가 되었습니다.`,
            senderName: approverUser?.name ?? '이전 결재자',
            linkUrl: `/gw/approval?doc=${next.id}`,
          });
        }
      }
    } catch (e) {
      console.error('승인 알림 전송 실패:', e);
    }

    return next;
  },

  /** 반려 — 활성 단계 결재자 또는 대결자 (사유 필수). */
  async reject(id: string, seq: number, userId: string, comment: string): Promise<ApprovalDoc> {
    const cur = await getOrThrow(id);
    const auth = await verifyApproverOrDelegate(cur, seq, userId);

    let docToProcess = cur;
    if (auth.isDelegate) {
      docToProcess = {
        ...cur,
        steps: cur.steps.map((s) =>
          s.seq === seq ? { ...s, approverId: userId, delegatedFromId: auth.originalApproverId } : s
        ),
      };
    }

    const next = applyDecision(docToProcess, seq, '반려', { at: now(), comment });
    await persist(next);
    await handleCancelTargetOnAbort(next);

    // 알림 생성 연동
    try {
      const { notificationRepo } = await import('@/data/notification/notification.repo');
      const users = await userRepo.list();
      const approverUser = users.find((u) => u.id === userId);

      await notificationRepo.create({
        userId: next.drafterId,
        type: '결재',
        title: '결재 반려',
        text: `[${next.title}] 결재가 반려되었습니다. (사유: ${comment})`,
        senderName: approverUser?.name ?? '결재자',
        linkUrl: `/gw/approval?doc=${next.id}`,
      });
      await notificationRepo.removePendingRequests(next.id);
    } catch (e) {
      console.error('반려 알림 전송 실패:', e);
    }

    return next;
  },

  /** 보류 — 활성 단계 결재자 또는 대결자. */
  async hold(id: string, seq: number, userId: string, comment = ''): Promise<ApprovalDoc> {
    const cur = await getOrThrow(id);
    await verifyApproverOrDelegate(cur, seq, userId);
    const next = applyDecision(cur, seq, '보류', { at: now(), comment });
    await persist(next);
    return next;
  },

  /** 후열 확인 — 원결재자가 대결 처리된 문서에 대해 사후 후열 확인 시각(postReadAt)을 기록. */
  async confirmPostRead(id: string, seq: number, userId: string): Promise<ApprovalDoc> {
    const cur = await getOrThrow(id);
    const target = cur.steps.find((s) => s.seq === seq);
    if (!target) throw new Error('결재선 노드를 찾을 수 없습니다.');
    if (target.delegatedFromId !== userId) {
      throw new Error('원결재자만 후열 확인을 완료할 수 있습니다.');
    }

    const next: ApprovalDoc = {
      ...cur,
      steps: cur.steps.map((s) =>
        s.seq === seq ? { ...s, postReadAt: now() } : s
      ),
    };
    await persist(next);
    return next;
  },

  /** 회수 — 진행중 문서를 기안자가 상신 취소(엔진 위임). */
  async recall(id: string, userId: string, reason?: string): Promise<ApprovalDoc> {
    const cur = await getOrThrow(id);
    if (cur.drafterId !== userId) throw new Error('기안자만 회수할 수 있습니다');
    
    // 이미 승인을 완료했던 타 결재자 목록 추출 (알림 통보용, 중복 제거)
    const approvedApproverIds = Array.from(
      new Set(
        cur.steps
          .filter((s) => s.kind !== '참조' && s.decision === '승인' && s.approverId !== userId)
          .map((s) => s.approverId)
      )
    );

    const next = recallDoc(cur, { reason, userId, allowMidRecall: true });
    await persist(next);
    await handleCancelTargetOnAbort(next);

    try {
      const { notificationRepo } = await import('@/data/notification/notification.repo');
      await notificationRepo.removePendingRequests(next.id);

      if (approvedApproverIds.length > 0) {
        const users = await userRepo.list();
        const drafter = users.find((u) => u.id === userId);
        const drafterName = drafter?.name || cur.drafterName || '기안자';
        const reasonText = reason ? ` (사유: ${reason})` : '';

        for (const approverId of approvedApproverIds) {
          await notificationRepo.create({
            userId: approverId,
            type: '결재',
            title: '결재 회수 알림',
            text: `${drafterName}님이 '${cur.title}' 문서를 회수하였습니다.${reasonText}`,
            senderName: drafterName,
            linkUrl: `/gw/approval?doc=${cur.id}`,
          });
        }
      }
    } catch (e) {
      console.error('회수 알림 처리 실패:', e);
    }

    return next;
  },

  /**
   * 대결(위임 승인) — 부재중 원 결재자를 대신해 delegateUserId 가 승인.
   * delegatedFromId 에 원 결재자를 기록한다(§4.2 대결).
   */
  async delegate(id: string, seq: number, delegateUserId: string, comment = ''): Promise<ApprovalDoc> {
    const cur = await getOrThrow(id);
    const target = cur.steps.find((s) => s.seq === seq);
    if (!target) throw new Error('결재선 노드를 찾을 수 없습니다');
    if (!isActiveApprover(cur, target.approverId)) throw new Error('현재 활성 단계가 아닙니다');
    const users = await userRepo.list();
    const delegateUser = users.find((u) => u.id === delegateUserId);

    // 원 결재자를 대결자로 교체하고(실제 결정자) 원 결재자를 위임 기록으로 남긴다.
    const delegated: ApprovalDoc = {
      ...cur,
      steps: cur.steps.map((s) =>
        s.seq === seq ? { ...s, approverId: delegateUserId, delegatedFromId: target.approverId } : s,
      ),
    };
    const next = applyDecision(delegated, seq, '승인', { at: now(), comment });
    next.steps = next.steps.map((s) => {
      if (s.seq === seq && s.approverId === delegateUserId) {
        return {
          ...s,
          signUrl: delegateUser?.signUrl ?? null,
          sealUrl: delegateUser?.sealUrl ?? null,
          signType: delegateUser?.signType ?? null,
          approverName: delegateUser?.name ?? null,
          approverPos: delegateUser?.position ?? null,
          approverDept: delegateUser?.dept ?? null,
        };
      }
      return s;
    });



    await persist(next);
    await handleCancelTargetOnComplete(next);
    return next;
  },

  /** 휴지통으로 보내기 (임시저장만 가능) */
  async deleteToTrash(id: string): Promise<ApprovalDoc> {
    const cur = await getOrThrow(id);
    if (cur.status !== '임시저장') throw new Error('임시저장 문서만 휴지통으로 보낼 수 있습니다');
    const next = { ...cur, status: '삭제' as const };
    await persist(next);
    return next;
  },

  /** 휴지통에서 복구 */
  async restoreFromTrash(id: string): Promise<ApprovalDoc> {
    const cur = await getOrThrow(id);
    if (cur.status !== '삭제') throw new Error('휴지통에 있는 문서가 아닙니다');
    const next = { ...cur, status: '임시저장' as const };
    await persist(next);
    return next;
  },

  /** 영구 삭제 (휴지통 내 문서만 가능) */
  async permanentlyDelete(id: string): Promise<void> {
    const cur = await getOrThrow(id);
    if (cur.status !== '삭제') throw new Error('휴지통에 있는 문서만 영구 삭제할 수 있습니다');
    await backend.remove(id);
  },



  async searchCompletedDocs(params: {
    userId: string;
    userDept?: string;
    userDeptId?: string;
    keyword?: string;
  }): Promise<ApprovalDoc[]> {
    const docs = await loadAll();
    const { userId, userDept, userDeptId, keyword } = params;

    // 1. 완료 상태 문서만 필터링
    let completedList = docs.filter((d) => d.status === '완료');

    // 2. 열람 권한 검증: 기안자, 결재선 참여자, 수신/참조처, 시행자/시행부서
    completedList = completedList.filter((doc) => {
      // 기안자
      if (doc.drafterId === userId) return true;
      // 결재선
      if (doc.steps.some((s) => s.approverId === userId)) return true;
      // 수신/참조처(recipients)
      if (
        doc.recipients?.some((r) => {
          if (r.type === 'user') return r.id === userId;
          if (r.type === 'dept') return r.id === userDeptId || r.name === userDept || r.id === userDept;
          if (r.type === 'drafter') return doc.drafterId === userId;
          return false;
        })
      ) {
        return true;
      }
      return false;
    });

    // 3. 키워드 검색 (문서제목, 문서번호, 기안자명)
    if (keyword && keyword.trim()) {
      const kw = keyword.trim().toLowerCase();
      completedList = completedList.filter(
        (d) =>
          d.title.toLowerCase().includes(kw) ||
          d.docNo.toLowerCase().includes(kw) ||
          (d.drafterName && d.drafterName.toLowerCase().includes(kw))
      );
    }

    return completedList.sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? ''));
  },

  subscribe(callback: (docs: ApprovalDoc[]) => void): () => void {
    return backend.subscribe(callback);
  },
};
