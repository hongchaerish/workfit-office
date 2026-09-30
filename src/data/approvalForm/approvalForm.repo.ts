import { approvalFormSchema, approvalFolderSchema, type ApprovalForm, type ApprovalFolder } from '@/domain/approvalForm/schema';
import { APPROVAL_FORM_SEED } from '@/data/seeds/approvalForm.seed';
import { createCrudBackend } from '@/data/_backend/crudBackend';

/**
 * 결재서식 Repository — DB 접근을 캡슐화하는 유일한 계층.
 * 문서 ID = form.id(=code). 저장은 공유 CrudBackend(VITE_DB_DRIVER)로 위임.
 * ([[Firestore_Appwrite_이관_단계별_계획서]] Phase 3 · [[DB_이관_대비_설계원칙.md]] 원칙 1)
 */

// 목업/초기 폴더 시드 데이터
const INITIAL_FOLDER_SEED: ApprovalFolder[] = [
  { id: 'fld-hr', name: '인사', order: 1 },
  { id: 'fld-ga', name: '총무', order: 2 },
  { id: 'fld-req', name: '품의', order: 3 },
  { id: 'fld-cond', name: '경조사', order: 4 },
];

const backend = createCrudBackend<ApprovalForm>({
  coll: 'approvalForms',
  parse: (raw) => {
    const p = approvalFormSchema.safeParse(raw);
    if (!p.success) {
      console.error('Failed to parse approvalForm:', p.error);
      return null;
    }
    return p.data;
  },
  idOf: (x) => x.id,
  seed: APPROVAL_FORM_SEED.map((x) => approvalFormSchema.parse(x)),
  jsonFields: ['fields'],
  stripFields: ['allowedJobTitles', 'allowedUserIds', 'referenceDeptId', 'referenceUserId'],
});

const folderBackend = createCrudBackend<ApprovalFolder>({
  coll: 'approvalFolders',
  parse: (raw) => {
    const p = approvalFolderSchema.safeParse(raw);
    if (!p.success) {
      console.error('Failed to parse approvalFolder:', p.error);
      return null;
    }
    return p.data;
  },
  idOf: (f) => f.id,
  seed: INITIAL_FOLDER_SEED.map((x) => approvalFolderSchema.parse(x)),
});

const byOrder = (a: ApprovalForm, b: ApprovalForm) => a.order - b.order || a.name.localeCompare(b.name);
const byFolderOrder = (a: ApprovalFolder, b: ApprovalFolder) => a.order - b.order || a.name.localeCompare(b.name);

export const approvalFormRepo = {
  async list(): Promise<ApprovalForm[]> {
    const obsoleteFormIds = [
      '출장', '보험신청', '운반비청구', '공문발송', '접대비품의',
      '비용청구', '단체상해보험변경', '단체상해보험재가입', '화재보험', '자동차보험',
      '우편택배청구', '퀵서비스청구', '일반공문', '법률문서', '접대비내', '접대비초과',
      '식대', '회식비', '회의비', '교통비', '운반비'
    ];
    let list = await backend.loadAll();

    // 구 서식(obsolete) 삭제
    for (const obsId of obsoleteFormIds) {
      if (list.some((f) => f.id === obsId)) {
        await backend.remove(obsId);
        list = list.filter((f) => f.id !== obsId);
      }
    }

    // 표준 서식(휴가, 외근, 국내출장, 해외출장)의 최신 표준 필드 스펙을 반영하여 결재서식 관리에 노출
    const seedMap = new Map<string, ApprovalForm>();
    for (const seedForm of APPROVAL_FORM_SEED) {
      seedMap.set(seedForm.id, approvalFormSchema.parse(seedForm));
    }

    const mergedList: ApprovalForm[] = [];
    const seenIds = new Set<string>();

    for (const item of list) {
      seenIds.add(item.id);
      const seedForm = seedMap.get(item.id);
      if (seedForm && ['휴가', '외근', '국내출장', '해외출장'].includes(item.id)) {
        // 표준 서식의 경우 SEED의 최신 표준 필드 정의를 반영하고, 기존 사용자가 추가한 커스텀 필드는 보존
        const seedFieldKeys = new Set(seedForm.fields.map((f) => f.key));
        const customFields = (item.fields || []).filter((f) => !seedFieldKeys.has(f.key));
        mergedList.push({
          ...item,
          name: item.name || seedForm.name,
          docTitle: item.docTitle || seedForm.docTitle,
          icon: item.icon || seedForm.icon,
          closing: item.closing || seedForm.closing,
          folderId: item.folderId || seedForm.folderId,
          fields: [...seedForm.fields, ...customFields],
        });
      } else {
        mergedList.push(item);
      }
    }

    // 만약 DB에 아직 없는 SEED 서식이 있다면 추가
    for (const [id, seedForm] of seedMap.entries()) {
      if (!seenIds.has(id)) {
        mergedList.push(seedForm);
      }
    }

    return mergedList.sort(byOrder);
  },

  async save(form: ApprovalForm): Promise<void> {
    // 1. 필드 데이터 정제: 빈 key 자동 채번, 유효한 너비/옵션 보장
    const cleanFields = (form.fields || []).map((f, idx) => ({
      ...f,
      key: (f.key || '').trim() || `field_${idx + 1}_${Date.now().toString(36).slice(-4)}`,
      label: (f.label || '').trim() || f.key || `항목 ${idx + 1}`,
      options: Array.isArray(f.options) ? f.options.filter(Boolean) : [],
      width: f.width === 'half' ? ('half' as const) : ('full' as const),
      tabOverrides: f.tabOverrides && typeof f.tabOverrides === 'object' ? f.tabOverrides : {},
      visibleIf: f.visibleIf || null,
      isAmountKey: Boolean(f.isAmountKey),
      isTabSelector: Boolean(f.isTabSelector),
      isSecret: Boolean(f.isSecret),
    }));

    // 2. 메타 속성 정제 (빈 문자열 -> null/유효값)
    const sanitized: ApprovalForm = {
      ...form,
      id: (form.id || form.code).trim(),
      code: form.code.trim(),
      name: form.name.trim(),
      icon: form.icon || '📄',
      docTitle: form.docTitle || '',
      closing: form.closing || '',
      active: Boolean(form.active),
      order: typeof form.order === 'number' && !isNaN(form.order) ? form.order : 0,
      system: Boolean(form.system),
      fields: cleanFields,
      folderId: form.folderId || null,
      recipientDeptId: form.recipientDeptId || null,
      recipientUserId: form.recipientUserId || null,
      recipientDrafter: Boolean(form.recipientDrafter),
      allowedPositionFromRank:
        typeof form.allowedPositionFromRank === 'number' && !isNaN(form.allowedPositionFromRank)
          ? form.allowedPositionFromRank
          : null,
      allowedPositionToRank:
        typeof form.allowedPositionToRank === 'number' && !isNaN(form.allowedPositionToRank)
          ? form.allowedPositionToRank
          : null,
      allowedDeptIds: Array.isArray(form.allowedDeptIds) ? form.allowedDeptIds : [],
      preservationPeriod: form.preservationPeriod || '5년',
      securityLevel: (['일반', '대외비', '극비'] as const).includes(form.securityLevel as any)
        ? form.securityLevel
        : '일반',
      visibility: form.visibility === '비공개' ? '비공개' : '부서',
    };

    const parsed = approvalFormSchema.parse(sanitized);
    await backend.save(parsed);
  },

  async remove(id: string): Promise<void> {
    await backend.remove(id);
  },

  // --- 폴더(분류) CRUD 메서드 추가 ---
  async listFolders(): Promise<ApprovalFolder[]> {
    const list = await folderBackend.loadAll();

    // 인사, 총무, 품의, 경조사 폴더 유실 방지 및 자동 복구
    for (const f of INITIAL_FOLDER_SEED) {
      if (!list.some((ex) => ex.id === f.id)) {
        await folderBackend.save(f);
        list.push(f);
      }
    }
    return [...list].sort(byFolderOrder);
  },

  async saveFolder(folder: ApprovalFolder): Promise<void> {
    await folderBackend.save(approvalFolderSchema.parse(folder));
  },

  async removeFolder(folderId: string): Promise<void> {
    // 1. 폴더 삭제
    await folderBackend.remove(folderId);

    // 2. 해당 폴더 아래에 있던 서식들을 루트(null)로 구출
    const forms = await this.list();
    const childForms = forms.filter((f) => f.folderId === folderId);
    for (const form of childForms) {
      form.folderId = null;
      await this.save(form);
    }
  }
};
