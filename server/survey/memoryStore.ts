import type { Survey } from '@/domain/survey/schema';
import type { SurveyQuestion } from '@/domain/surveyQuestion/schema';
import type { SurveyResponse } from '@/domain/surveyResponse/schema';
import type { SurveyAnswer } from '@/domain/surveyAnswer/schema';
import type { SurveyParticipation } from '@/domain/surveyParticipation/schema';
import type { Coll, SurveyStorePort } from './port';

type Row = { id: string };

export type MemoryStore = SurveyStorePort & {
  dump(coll: Coll): Row[];
  /** 지정한 컬렉션의 다음 insert 를 한 번 실패시킨다(보상 처리 시험용). */
  failNextInsert?: Coll;
};

/** 테스트용 메모리 저장소. 깊은 복사로 돌려줘 호출부가 내부 상태를 바꾸지 못하게 한다. */
export function createMemoryStore(seed: Partial<Record<Coll, Row[]>> = {}): MemoryStore {
  const data: Record<Coll, Map<string, Row>> = {
    surveys: new Map(),
    surveyQuestions: new Map(),
    surveyResponses: new Map(),
    surveyAnswers: new Map(),
    surveyParticipations: new Map(),
  };
  for (const [coll, rows] of Object.entries(seed) as [Coll, Row[]][]) {
    for (const row of rows) data[coll].set(row.id, structuredClone(row));
  }
  const all = <T>(coll: Coll) => [...data[coll].values()].map((row) => structuredClone(row) as T);
  const bySurvey = <T extends { surveyId: string }>(coll: Coll, surveyId: string) =>
    all<T>(coll).filter((row) => row.surveyId === surveyId);

  const store: MemoryStore = {
    async getSurvey(id) {
      const row = data.surveys.get(id);
      return row ? (structuredClone(row) as Survey) : null;
    },
    async listSurveys(filter) {
      return all<Survey>('surveys').filter((row) => !filter?.ownerUserId || row.ownerUserId === filter.ownerUserId);
    },
    async listQuestions(surveyId) { return bySurvey<SurveyQuestion>('surveyQuestions', surveyId); },
    async listResponses(surveyId) { return bySurvey<SurveyResponse>('surveyResponses', surveyId); },
    async listAnswers(surveyId) { return bySurvey<SurveyAnswer>('surveyAnswers', surveyId); },
    async countResponses(surveyId) { return bySurvey<SurveyResponse>('surveyResponses', surveyId).length; },
    async hasParticipation(surveyId, userId) { return data.surveyParticipations.has(`${surveyId}__${userId}`); },
    async listParticipatedSurveyIds(userId) {
      return all<SurveyParticipation>('surveyParticipations')
        .filter((row) => row.userId === userId)
        .map((row) => row.surveyId);
    },
    async insert(coll, row) {
      if (store.failNextInsert === coll) {
        store.failNextInsert = undefined;
        throw new Error(`insert ${coll} 실패(테스트)`);
      }
      if (data[coll].has(row.id)) return 'exists';
      data[coll].set(row.id, structuredClone(row));
      return 'created';
    },
    async save(coll, row) { data[coll].set(row.id, structuredClone(row)); },
    async remove(coll, id) { data[coll].delete(id); },
    dump(coll) { return all<Row>(coll); },
  };
  return store;
}
