import type { User } from '@/domain/user/schema';
import type { SurveyDraft } from '@/domain/survey/schema';
import { createMemoryStore, type MemoryStore } from './memoryStore';
import type { Actor, DirectoryPort, ServiceCtx } from './port';

/** 설문 서버 테스트 공용 픽스처. */
export const NOW = new Date('2026-10-14T03:00:00Z'); // 12:00 KST

export const user = (id: string, dept = '개발팀', status: User['status'] = '사용'): User =>
  ({ id, empNo: id, name: `사용자${id}`, dept, position: '사원', status } as User);

export const directory = (users: User[]): DirectoryPort => ({
  async listUsers() { return users; },
  async listDepartments() { return [{ id: 'D1', name: '개발팀' }, { id: 'D2', name: '영업팀' }] as never; },
  async listRoleGroups() { return []; },
  async listPositions() { return []; },
});

let seq = 0;
export function makeCtx(actor: Actor, store: MemoryStore = createMemoryStore(), users: User[] = [actor.user]): ServiceCtx & { store: MemoryStore } {
  return {
    store,
    directory: directory(users),
    actor,
    now: () => NOW,
    newId: () => `rand${(seq += 1).toString(36)}x`,
    random: () => 0.5,
  };
}

export const actorOf = (u: User, isAdmin = false): Actor => ({ user: u, deptId: u.dept === '영업팀' ? 'D2' : 'D1', isAdmin });

export const DRAFT: SurveyDraft = {
  title: '만족도 조사',
  description: '',
  categoryCode: 'EMPLOYEE',
  audienceType: 'COMPANY',
  audienceDeptIds: [],
  audienceUserIds: [],
  anonymous: true,
  startsAt: '2026-10-14T00:00:00.000Z',
  endsAt: '2026-10-20T00:00:00.000Z',
  showResultToRespondent: false,
};

export const RATING_Q = {
  id: null, type: 'RATING' as const, title: '만족하나요?', description: '', required: true, order: 0,
  options: [], ratingMinLabel: '불만', ratingMaxLabel: '만족', maxLength: null,
};

export const TEXT_Q = {
  id: null, type: 'LONG_TEXT' as const, title: '의견', description: '', required: false, order: 10,
  options: [], ratingMinLabel: '', ratingMaxLabel: '', maxLength: null,
};
