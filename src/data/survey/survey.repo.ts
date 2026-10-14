import type { User } from '@/domain/user/schema';
import type { Survey, SurveyDraft, SurveyStatus } from '@/domain/survey/schema';
import { callSurvey } from './survey.gateway';

export interface SurveyFilter {
  ownerUserId?: string;
  status?: SurveyStatus;
  categoryCode?: string;
  q?: string;
}

/** 화면 쪽 필터(상태·분류·검색어)는 받은 목록에 적용한다. 볼 수 있는 범위는 서버가 정한다. */
function applyFilter(rows: Survey[], filter?: SurveyFilter): Survey[] {
  const keyword = filter?.q?.trim().toLowerCase() ?? '';
  return rows.filter((row) =>
    (!filter?.status || row.status === filter.status)
    && (!filter?.categoryCode || row.categoryCode === filter.categoryCode)
    && (!keyword || [row.title, row.description].some((value) => value.toLowerCase().includes(keyword))),
  );
}

/**
 * 설문 Repository — 저장과 권한 판정은 Function `survey` 가 한다.
 * ([[docs/superpowers/specs/2026-10-14-survey-server-design.md]] §8)
 *
 * actor 인자는 호출부 호환을 위해 받지만 쓰지 않는다. 서버가 서명 토큰으로 요청자를 정한다.
 */
export const surveyRepo = {
  /** 내가 만든 설문(서버 `listMine`). */
  async list(filter?: SurveyFilter): Promise<Survey[]> {
    return applyFilter(await callSurvey<Survey[]>('listMine', {}), filter);
  },

  async get(id: string): Promise<Survey | null> {
    return callSurvey<Survey>('getSurvey', { id }).catch(() => null);
  },

  /** 참여할 설문 — 대상인 진행 중 설문과 이미 참여한 설문. */
  listForRespondent(_actor: User, _actorDeptId: string | null): Promise<Survey[]> {
    return callSurvey<Survey[]>('listForRespondent');
  },

  createDraft: (_actor: User, draft: SurveyDraft) => callSurvey<Survey>('createDraft', { draft }),
  updateBasics: (_actor: User, id: string, draft: SurveyDraft) => callSurvey<Survey>('updateBasics', { id, draft }),
  publish: (_actor: User, id: string) => callSurvey<Survey>('publish', { id }),
  close: (_actor: User, id: string) => callSurvey<Survey>('close', { id }),
  archive: (_actor: User, id: string) => callSurvey<Survey>('archive', { id }),
  /** 기본정보·질문만 새 초안으로. 응답·통계는 옮기지 않고 기간은 비운다. */
  duplicate: (_actor: User, id: string) => callSurvey<Survey>('duplicate', { id }),
  /** 초안만 삭제된다. 배포된 설문은 마감·보관으로 처리한다. */
  async remove(_actor: User, id: string): Promise<void> {
    await callSurvey<null>('remove', { id });
  },
};
