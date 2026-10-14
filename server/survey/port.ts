import type { Survey } from '@/domain/survey/schema';
import type { SurveyQuestion } from '@/domain/surveyQuestion/schema';
import type { SurveyResponse } from '@/domain/surveyResponse/schema';
import type { SurveyAnswer } from '@/domain/surveyAnswer/schema';
import type { User } from '@/domain/user/schema';
import type { Department } from '@/domain/department/schema';
import type { RoleGroup } from '@/domain/roleGroup/schema';
import type { Position } from '@/domain/position/schema';

/**
 * 설문 서버의 저장소 포트. 업무 규칙(manage·respond)은 이것만 보고, Appwrite·메모리 구현은
 * 바꿔 끼운다. ([[docs/superpowers/specs/2026-10-14-survey-server-design.md]] §3.3)
 */
export type Coll = 'surveys' | 'surveyQuestions' | 'surveyResponses' | 'surveyAnswers' | 'surveyParticipations';

export interface SurveyStorePort {
  getSurvey(id: string): Promise<Survey | null>;
  listSurveys(filter?: { ownerUserId?: string }): Promise<Survey[]>;
  listQuestions(surveyId: string): Promise<SurveyQuestion[]>;
  listResponses(surveyId: string): Promise<SurveyResponse[]>;
  listAnswers(surveyId: string): Promise<SurveyAnswer[]>;
  /** 응답 수와 가장 먼저 저장된 응답의 submittedAt(익명이면 날짜만). 설문 문서에 적어 두지 않고 읽을 때 센다. */
  responseStats(surveyId: string): Promise<{ count: number; firstSubmittedAt: string | null }>;
  hasParticipation(surveyId: string, userId: string): Promise<boolean>;
  listParticipatedSurveyIds(userId: string): Promise<string[]>;
  /** 새로 만들 때만 성공. 같은 ID가 있으면 'exists' — 1인 1회·채번 경쟁을 여기서 가른다. */
  insert(coll: Coll, row: { id: string }): Promise<'created' | 'exists'>;
  /** 있으면 덮고 없으면 만든다. */
  save(coll: Coll, row: { id: string }): Promise<void>;
  /** 준 칸만 고친다. 다른 요청이 그 사이 고친 칸을 덮지 않는다. */
  update(coll: Coll, id: string, patch: Record<string, unknown>): Promise<void>;
  /** 저장 결과를 모르는 쓰기(시간 초과) 뒤에 실제로 저장됐는지 확인한다. */
  exists(coll: Coll, id: string): Promise<boolean>;
  remove(coll: Coll, id: string): Promise<void>;
}

/** 요청자 해석·대상자 수·응답자 표기에 쓰는 명부. */
export interface DirectoryPort {
  listUsers(): Promise<User[]>;
  listDepartments(): Promise<Department[]>;
  listRoleGroups(): Promise<RoleGroup[]>;
  listPositions(): Promise<Position[]>;
}

/** 서명 토큰으로 확인한 요청자. 본문에 실려 온 사용자 ID는 쓰지 않는다. */
export interface Actor {
  user: User;
  deptId: string | null;
  isAdmin: boolean;
}

export interface ServiceCtx {
  store: SurveyStorePort;
  directory: DirectoryPort;
  actor: Actor;
  now: () => Date;
  newId: () => string;
  /** 익명 결과 섞기. 테스트에서 고정한다. */
  random?: () => number;
  /** 요청 마감까지 남은 시간(ms). 없으면 제한 없음. 쓰기를 시작하기 전에 확인한다. */
  remainingMs?: () => number;
}
