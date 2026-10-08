import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '@/app/auth/AuthProvider';
import { useCodeOptions } from '@/features/commonCode/useCommonCodes';
import { useDepartments } from '@/features/department/useDepartments';
import { useUsers } from '@/features/user/useUsers';
import {
  useCreateSurveyDraft,
  useMySurveys,
  useSurveyQuestions,
} from '@/features/survey/useSurveys';
import {
  resolveUserDeptId,
  useMyParticipations,
  useRespondentSurveys,
} from '@/features/survey/useSurveyResponse';
import {
  SURVEY_CATEGORY_GROUP_CODE,
  selectableSurveyCategories,
} from '@/domain/survey/category';
import { canCreateSurvey, SurveyError } from '@/domain/survey/engine';
import { GwHead, GwSideNav, GwSplit } from '@/modules/gw/_gw';
import SurveyBuilder from './SurveyBuilder';
import SurveyList from './SurveyList';
import SurveyParticipateList from './SurveyParticipateList';
import SurveyPreview from './SurveyPreview';
import SurveyResponseForm from './SurveyResponseForm';
import SurveyResult from './SurveyResult';
import { defaultSurveyPeriod } from './surveyDate';
import { Button } from '@/shared/ui/Button';

type TabId = 'participate' | 'mine';

const TAB_LABELS: Record<TabId, string> = {
  participate: '참여할 설문',
  mine: '내가 만든 설문',
};

function LocalSurveyScreen() {
  const { user: authenticatedUser } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [demoUserId, setDemoUserId] = useState('U009');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const usersQuery = useUsers();
  const departmentsQuery = useDepartments();
  const categoriesQuery = useCodeOptions(SURVEY_CATEGORY_GROUP_CODE);
  const users = usersQuery.data ?? [];
  const departments = useMemo(() => departmentsQuery.data ?? [], [departmentsQuery.data]);
  const actor = authenticatedUser
    ?? users.find((user) => user.id === demoUserId)
    ?? users.find((user) => user.status === '사용')
    ?? null;
  const actorDeptId = useMemo(() => resolveUserDeptId(departments, actor), [departments, actor]);

  const mineQuery = useMySurveys(actor);
  const respondentQuery = useRespondentSurveys(actor, actorDeptId);
  const participationQuery = useMyParticipations(actor);
  const createDraft = useCreateSurveyDraft();

  const mine = useMemo(() => mineQuery.data ?? [], [mineQuery.data]);
  const inbox = useMemo(() => respondentQuery.data ?? [], [respondentQuery.data]);

  const requestedTab = searchParams.get('tab') as TabId | null;
  const tab: TabId = requestedTab && requestedTab in TAB_LABELS ? requestedTab : 'participate';
  const editId = searchParams.get('edit');
  const previewId = searchParams.get('preview');
  const respondId = searchParams.get('respond');
  const resultId = searchParams.get('result');

  const openSurvey = (editId ?? previewId)
    ? mine.find((row) => row.id === (editId ?? previewId)) ?? null
    : null;
  const respondSurvey = respondId ? inbox.find((row) => row.id === respondId) ?? null : null;
  // 결과는 작성자와 참여자 모두 열 수 있어 두 목록에서 찾는다. 실제 조회 권한은 저장소가 판정한다.
  const resultSurvey = resultId
    ? mine.find((row) => row.id === resultId) ?? inbox.find((row) => row.id === resultId) ?? null
    : null;
  const detailId = editId ?? previewId ?? respondId ?? resultId;
  const detail = openSurvey ?? respondSurvey ?? resultSurvey;
  const questionsQuery = useSurveyQuestions(detail?.id ?? null);

  const loading = usersQuery.isLoading || departmentsQuery.isLoading || mineQuery.isLoading || respondentQuery.isLoading;
  const queryError = usersQuery.error ?? departmentsQuery.error ?? mineQuery.error ?? respondentQuery.error;

  const go = (params: Record<string, string>) => {
    setNotice('');
    setError('');
    setSearchParams(params);
  };

  const createNew = async () => {
    if (!actor) return;
    setError('');
    const period = defaultSurveyPeriod();
    try {
      const created = await createDraft.mutateAsync({
        actor,
        draft: {
          title: '제목 없는 설문',
          description: '',
          categoryCode: selectableSurveyCategories(categoriesQuery.data)[0]?.code ?? 'OTHER',
          audienceType: 'COMPANY',
          audienceDeptIds: [],
          audienceUserIds: [],
          anonymous: false,
          startsAt: period.startsAt,
          endsAt: period.endsAt,
          showResultToRespondent: false,
        },
      });
      go({ tab: 'mine', edit: created.id });
    } catch (caught) {
      setError(caught instanceof SurveyError ? caught.message : '설문을 만들지 못했습니다.');
    }
  };

  if (loading) return <div className="grid min-h-[calc(60vh/var(--font-scale,1))] place-items-center text-[12px] font-semibold text-ink3">전자설문을 불러오는 중…</div>;
  if (queryError) return <div className="grid min-h-[calc(60vh/var(--font-scale,1))] place-items-center px-5 text-center text-[12px] font-semibold text-red-500">전자설문 데이터를 불러오지 못했습니다.<br />{queryError instanceof Error ? queryError.message : ''}</div>;
  if (!actor) return <div className="grid min-h-[calc(60vh/var(--font-scale,1))] place-items-center text-[12px] font-semibold text-ink3">사용자 정보를 불러올 수 없습니다.</div>;

  const questions = questionsQuery.data ?? [];
  const hasOpenToAnswer = inbox.some((row) => row.status === 'ACTIVE' && !(participationQuery.data ?? []).includes(row.id));

  return (
    <div className="mx-auto w-full max-w-[1400px] px-4 py-5 sm:px-6 sm:py-6">
      <GwHead
        icon="🗳️"
        name="전자설문"
        right={
          <div className="flex items-center gap-2">
            {!authenticatedUser && (
              <select value={actor.id} onChange={(event) => { setDemoUserId(event.target.value); go({ tab }); }} title="사용자 선택" className="h-9 rounded-lg border border-amber/30 bg-amber-soft/30 px-3 text-[10.5px] font-bold text-ink outline-none">
                {users.filter((user) => user.status === '사용').map((user) => <option key={user.id} value={user.id}>{user.name} · {user.position || user.dept || '사원'}</option>)}
              </select>
            )}
            {canCreateSurvey(actor) && !detail && (
              <Button disabled={createDraft.isPending} onClick={createNew} variant="primary">+ 새 설문</Button>
            )}
          </div>
        }
      />

      {notice && <div className="mt-4 rounded-lg border border-teal/20 bg-teal-soft/25 px-3 py-2.5 text-[11px] font-semibold text-teal">{notice}</div>}
      {error && <div className="mt-4 rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2.5 text-[11px] font-semibold text-red-500">{error}</div>}
      {detailId && !detail && (
        <div className="mt-4 flex items-center justify-between gap-3 rounded-lg border border-amber/20 bg-amber-soft/25 px-3 py-2.5 text-[11px] font-semibold text-amber">
          <span>설문을 찾을 수 없거나 현재 계정에 접근 권한이 없습니다.</span>
          <button type="button" onClick={() => go({ tab })} className="shrink-0 rounded-md border border-amber/25 px-2 py-1 text-[9.5px] hover:bg-amber-soft/40">목록으로</button>
        </div>
      )}

      <GwSplit
        nav={(
          <GwSideNav
            title="전자설문"
            desc="설문을 만들고 참여합니다."
            items={[
              { id: 'participate', icon: '🙋', label: TAB_LABELS.participate, badge: hasOpenToAnswer ? '참여' : undefined },
              { id: 'mine', icon: '📝', label: TAB_LABELS.mine },
            ]}
            activeId={tab}
            onSelect={(id) => go({ tab: id })}
          />
        )}
      >
        <main>
        {respondSurvey && (
          <SurveyResponseForm
            key={respondSurvey.id}
            actor={actor}
            actorDeptId={actorDeptId}
            survey={respondSurvey}
            questions={questions}
            onSubmitted={() => { go({ tab: 'participate' }); setNotice('설문에 참여했습니다. 응답해 주셔서 감사합니다.'); }}
            onBack={() => go({ tab: 'participate' })}
          />
        )}
        {resultSurvey && (
          <SurveyResult
            key={resultSurvey.id}
            actor={actor}
            survey={resultSurvey}
            questions={questions}
            users={users}
            departments={departments}
            onBack={() => go({ tab })}
            onNotice={setNotice}
          />
        )}
        {openSurvey && previewId && (
          <SurveyPreview survey={openSurvey} questions={questions} onBack={() => go({ tab: 'mine' })} />
        )}
        {openSurvey && editId && (
          <SurveyBuilder
            key={openSurvey.id}
            actor={actor}
            survey={openSurvey}
            questions={questions}
            categories={categoriesQuery.data ?? []}
            departments={departments}
            users={users}
            onNotice={setNotice}
            onBack={() => go({ tab: 'mine' })}
          />
        )}
        {!detail && tab === 'participate' && (
          <SurveyParticipateList
            surveys={inbox}
            participatedIds={participationQuery.data ?? []}
            users={users}
            categories={categoriesQuery.data ?? []}
            onRespond={(id) => go({ tab: 'participate', respond: id })}
            onResult={(id) => go({ tab: 'participate', result: id })}
          />
        )}
        {!detail && tab === 'mine' && (
          <SurveyList
            actor={actor}
            surveys={mine}
            categories={categoriesQuery.data ?? []}
            onEdit={(id) => go({ tab: 'mine', edit: id })}
            onPreview={(id) => go({ tab: 'mine', preview: id })}
            onResult={(id) => go({ tab: 'mine', result: id })}
            onNotice={setNotice}
          />
        )}
        </main>
      </GwSplit>
    </div>
  );
}

export default function SurveyScreen() {
  return <LocalSurveyScreen />;
}
