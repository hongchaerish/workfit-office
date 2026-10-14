import { Client, Databases, Query } from 'node-appwrite';
import { surveySchema } from '@/domain/survey/schema';
import { surveyQuestionSchema } from '@/domain/surveyQuestion/schema';
import { surveyResponseSchema } from '@/domain/surveyResponse/schema';
import { surveyAnswerSchema } from '@/domain/surveyAnswer/schema';
import { surveyParticipationSchema } from '@/domain/surveyParticipation/schema';
import { userSchema } from '@/domain/user/schema';
import { departmentSchema } from '@/domain/department/schema';
import { roleGroupSchema } from '@/domain/roleGroup/schema';
import { positionSchema } from '@/domain/position/schema';
import type { Coll, DirectoryPort, SurveyStorePort } from '../../../../server/survey/port';
import { withDeadline } from '../../../../server/survey/deadline';

/** Appwrite 스칼라 속성에 못 담는 중첩 필드 — 앱의 crudBackend 와 같은 규칙으로 JSON 문자열에 담는다. */
const JSON_FIELDS: Partial<Record<string, string[]>> = {
  surveyQuestions: ['options'],
  roleGroups: ['members', 'menuPermissions'],
};
const SYSTEM_FIELDS = ['$id', '$createdAt', '$updatedAt', '$permissions', '$databaseId', '$collectionId', '$sequence'];
const PAGE = 100;

type Parser<T> = { safeParse(value: unknown): { success: boolean; data?: T } };
const isCode = (error: unknown, code: number) => (error as { code?: number })?.code === code;

/** node-appwrite 로 설문 저장소·명부 포트를 만든다. 키는 함수의 동적 키(x-appwrite-key)를 쓴다. */
export function createAppwritePorts(endpoint: string, project: string, key: string, databaseId: string, trace?: (message: string) => void) {
  const raw = new Databases(new Client().setEndpoint(endpoint).setProject(project).setKey(key));
  /**
   * 모든 DB 호출에 시간 제한을 건다(`server/survey/deadline.ts` 참고). 읽기는 멈추면 다시 보내고,
   * 쓰기는 다시 보내지 않는다. SURVEY_DEBUG 이면 호출마다 걸린 시간을 로그로 남긴다.
   */
  const dbs = new Proxy(raw, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== 'function') return value;
      const read = prop === 'listDocuments' || prop === 'getDocument';
      return async (...args: unknown[]) => {
        const started = Date.now();
        const label = `${String(prop)} ${(args[0] as { collectionId?: string })?.collectionId ?? ''}`;
        trace?.(`→ ${label}`);
        try {
          return await withDeadline(
            () => (value as (...a: unknown[]) => Promise<unknown>).apply(target, args),
            read ? { timeoutMs: 4000, attempts: 3, label } : { timeoutMs: 10000, attempts: 1, label },
          );
        } finally {
          trace?.(`← ${label} ${Date.now() - started}ms`);
        }
      };
    },
  });

  const decode = (coll: string, doc: Record<string, unknown>) => {
    const row: Record<string, unknown> = { ...doc };
    if (!row.id) row.id = row.$id;
    for (const field of SYSTEM_FIELDS) delete row[field];
    for (const field of JSON_FIELDS[coll] ?? []) {
      const value = row[field];
      row[field] = typeof value === 'string' && value ? JSON.parse(value) : (value ?? []);
    }
    return row;
  };
  const encode = (coll: string, item: { id: string }) => {
    const row: Record<string, unknown> = { ...item };
    for (const field of JSON_FIELDS[coll] ?? []) row[field] = row[field] == null ? null : JSON.stringify(row[field]);
    return row;
  };

  /** 커서 페이지네이션으로 전건 조회. 불량 문서는 건너뛴다(목록 전체가 죽지 않게). */
  async function listAll<T>(coll: string, schema: Parser<T>, queries: string[] = []): Promise<T[]> {
    const out: T[] = [];
    let cursor: string | undefined;
    for (;;) {
      const page = await dbs.listDocuments({
        databaseId,
        collectionId: coll,
        queries: [...queries, Query.limit(PAGE), ...(cursor ? [Query.cursorAfter(cursor)] : [])],
      });
      for (const doc of page.documents as unknown as Record<string, unknown>[]) {
        const parsed = schema.safeParse(decode(coll, doc));
        if (parsed.success && parsed.data !== undefined) out.push(parsed.data);
      }
      if (page.documents.length < PAGE) return out;
      cursor = page.documents[page.documents.length - 1].$id;
    }
  }
  const bySurvey = (surveyId: string) => [Query.equal('surveyId', surveyId)];

  const store: SurveyStorePort = {
    async getSurvey(id) {
      try {
        const doc = await dbs.getDocument({ databaseId, collectionId: 'surveys', documentId: id });
        return surveySchema.parse(decode('surveys', doc as unknown as Record<string, unknown>));
      } catch (error) {
        if (isCode(error, 404)) return null;
        throw error;
      }
    },
    listSurveys: (filter) =>
      listAll('surveys', surveySchema, filter?.ownerUserId ? [Query.equal('ownerUserId', filter.ownerUserId)] : []),
    listQuestions: (surveyId) => listAll('surveyQuestions', surveyQuestionSchema, bySurvey(surveyId)),
    listResponses: (surveyId) => listAll('surveyResponses', surveyResponseSchema, bySurvey(surveyId)),
    listAnswers: (surveyId) => listAll('surveyAnswers', surveyAnswerSchema, bySurvey(surveyId)),
    async countResponses(surveyId) {
      const page = await dbs.listDocuments({
        databaseId,
        collectionId: 'surveyResponses',
        queries: [...bySurvey(surveyId), Query.limit(1)],
      });
      return page.total;
    },
    async hasParticipation(surveyId, userId) {
      try {
        await dbs.getDocument({ databaseId, collectionId: 'surveyParticipations', documentId: `${surveyId}__${userId}` });
        return true;
      } catch (error) {
        if (isCode(error, 404)) return false;
        throw error;
      }
    },
    async listParticipatedSurveyIds(userId) {
      const rows = await listAll('surveyParticipations', surveyParticipationSchema, [Query.equal('userId', userId)]);
      return rows.map((row) => row.surveyId);
    },
    async insert(coll: Coll, row) {
      try {
        await dbs.createDocument({ databaseId, collectionId: coll, documentId: row.id, data: encode(coll, row) });
        return 'created';
      } catch (error) {
        if (isCode(error, 409)) return 'exists';
        throw error;
      }
    },
    async save(coll: Coll, row) {
      try {
        await dbs.updateDocument({ databaseId, collectionId: coll, documentId: row.id, data: encode(coll, row) });
      } catch (error) {
        if (!isCode(error, 404)) throw error;
        await dbs.createDocument({ databaseId, collectionId: coll, documentId: row.id, data: encode(coll, row) });
      }
    },
    async remove(coll: Coll, id) {
      try {
        await dbs.deleteDocument({ databaseId, collectionId: coll, documentId: id });
      } catch (error) {
        if (!isCode(error, 404)) throw error;
      }
    },
  };

  const directory: DirectoryPort = {
    listUsers: () => listAll('users', userSchema),
    listDepartments: () => listAll('departments', departmentSchema),
    listRoleGroups: () => listAll('roleGroups', roleGroupSchema),
    listPositions: () => listAll('positions', positionSchema),
  };

  return { store, directory };
}
