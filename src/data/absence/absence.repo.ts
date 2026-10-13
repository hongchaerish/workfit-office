import { userAbsenceSchema, type UserAbsenceConfig } from '@/domain/absence/schema';
import { createCrudBackend } from '@/data/_backend/crudBackend';

/** 예전 브라우저 저장 키 접두사(+userId) — DB 이전([[migrateLegacySharedSettings]]) 때만 읽는다. */
export const LEGACY_ABSENCE_STORAGE_PREFIX = 'workfit_absence_config_';

export function parseAbsence(raw: unknown): UserAbsenceConfig | null {
  const p = userAbsenceSchema.safeParse(raw);
  return p.success ? p.data : null;
}

/** 사용자당 문서 하나($id = userId). 대결자가 대신 결재하려면 모두가 읽을 수 있어야 해서 DB(userAbsences)에 둔다. */
export const absenceBackend = createCrudBackend<UserAbsenceConfig>({
  coll: 'userAbsences',
  parse: parseAbsence,
  idOf: (x) => x.userId,
  seed: [],
});

const emptyConfig = (userId: string): UserAbsenceConfig => ({
  userId,
  isAbsent: false,
  startDate: null,
  endDate: null,
  delegateUserId: null,
  reason: '',
  scope: 'ALL',
  allowedDocTypes: [],
  maxDelegateAmount: null,
  updatedAt: null,
});

export const absenceRepo = {
  /** 전체 사용자의 부재 설정(설정한 사람만). */
  async list(): Promise<UserAbsenceConfig[]> {
    return absenceBackend.loadAll();
  },

  /** 특정 사용자의 부재 및 대결 설정 조회(없으면 기본값). */
  async get(userId: string): Promise<UserAbsenceConfig> {
    const all = await this.list();
    return all.find((c) => c.userId === userId) ?? emptyConfig(userId);
  },

  /** 사용자 부재 설정 저장. */
  async save(config: UserAbsenceConfig): Promise<UserAbsenceConfig> {
    const next: UserAbsenceConfig = {
      ...config,
      updatedAt: new Date().toISOString(),
    };
    await absenceBackend.save(next);
    return next;
  },

  /** 현 시점(now) 기준 사용자가 부재 및 대결 활성 상태인가 판별 (서식 범위 및 최고 금액 제한 검증 포함) */
  async isCurrentlyAbsent(
    userId: string,
    docType?: string,
    docAmount?: number | null
  ): Promise<{ isAbsent: boolean; delegateUserId: string | null; blockReason?: string }> {
    const cfg = await this.get(userId);
    if (!cfg.isAbsent || !cfg.delegateUserId) {
      return { isAbsent: false, delegateUserId: null };
    }
    const now = new Date();
    if (cfg.startDate) {
      const start = new Date(cfg.startDate);
      if (now < start) return { isAbsent: false, delegateUserId: null };
    }
    if (cfg.endDate) {
      const end = new Date(cfg.endDate);
      if (now > end) return { isAbsent: false, delegateUserId: null };
    }

    // 1. 서식 범위 검증: 특정 서식 한정인 경우 docType 매칭 검사
    if (cfg.scope === 'SPECIFIC_FORMS' && docType) {
      if (!cfg.allowedDocTypes || !cfg.allowedDocTypes.includes(docType)) {
        return { isAbsent: false, delegateUserId: null, blockReason: '대결 위임이 허용된 문서 서식이 아닙니다.' };
      }
    }

    // 2. 최고 금액 제한 검증: 금액이 존재하는 문서이고, maxDelegateAmount 가 설정되어 있는 경우
    if (docAmount != null && cfg.maxDelegateAmount != null && cfg.maxDelegateAmount > 0) {
      if (docAmount > cfg.maxDelegateAmount) {
        return {
          isAbsent: false,
          delegateUserId: null,
          blockReason: `대결 허용 최고 금액(${cfg.maxDelegateAmount.toLocaleString()}원)을 초과한 문서입니다.`,
        };
      }
    }

    return { isAbsent: true, delegateUserId: cfg.delegateUserId };
  },
};
