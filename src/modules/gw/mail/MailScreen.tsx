import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '@/app/auth/AuthProvider';
import { useUsers } from '@/features/user/useUsers';
import type { MailAccount } from '@/domain/mailAccount/schema';
import type { User } from '@/domain/user/schema';
import { MAIL_ERROR_GUIDE, mailErrorText, mailRefKey, parseMailRefKey } from '@/domain/mail/engine';
import {
  MAIL_FETCH_PER_ACCOUNT,
  MAIL_FETCH_PER_ACCOUNT_MAX,
  MAIL_FOLDER_LABELS,
  MAIL_FOLDERS,
  type MailAddress,
  type MailComposeMode,
  type MailFolder,
  type MailSummary,
} from '@/domain/mail/schema';
import { isMailBackendReady, isMailSampleData } from '@/data/mail/mail.client';
import { useMailAccounts } from '@/features/mail/useMailAccounts';
import {
  saveAttachment,
  useDownloadAttachment,
  useInbox,
  useMailDetail,
  useMailFolders,
  useMarkFlagged,
  useMarkMailRead,
  useUnseenCount,
  useMoveMail,
} from '@/features/mail/useMailbox';
import { useMailDrafts, useRemoveMailDraft } from '@/features/mail/useMailDrafts';
import { GwHead } from '@/modules/gw/_gw';
import { Button } from '@/shared/ui/Button';
import { Modal } from '@/shared/ui/Modal';
import MailAccountDialog from './MailAccountDialog';
import MailAccountManageDialog from './MailAccountManageDialog';
import MailAccountPicker from './MailAccountPicker';
import MailDraftList from './MailDraftList';
import MailFolderNav from './MailFolderNav';
import MailComposer from './MailComposer';
import MailDetail from './MailDetail';
import MailList from './MailList';

/**
 * 메일 서버가 연결되지 않았을 때.
 *
 * 사실만 적는다. 개발 진행 상황이나 승인 절차는 사용자가 할 수 있는 일이 아니다.
 * 샘플 데이터로 대신 채우지도 않는다 — 가짜 메일을 자기 메일함으로 오해하게 된다.
 */
function MailBackendMissing() {
  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-6 sm:px-6">
      <GwHead icon="✉️" name="메일" />
      <div className="mt-6 rounded-xl border border-border bg-panel p-8 text-center shadow-sm">
        <div className="text-3xl">✉️</div>
        <div className="mt-3 text-[14px] font-extrabold text-ink">메일 서버에 연결되어 있지 않습니다.</div>
        <p className="mx-auto mt-2 max-w-xl text-[11px] leading-relaxed text-ink3">
          메일을 주고받으려면 메일 서버 연결이 필요합니다. 시스템 관리자에게 문의해 주세요.
        </p>
      </div>
    </div>
  );
}

function LocalMailScreen() {
  const { user: authenticatedUser } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [demoUserId, setDemoUserId] = useState('U009');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [compose, setCompose] = useState<MailComposeMode | null>(null);
  /** 보낸사람 주소 클릭으로 여는 새 메일의 받는 사람 초기값. */
  const [composeTo, setComposeTo] = useState<MailAddress[] | null>(null);
  /** 계정 모달 — `null`이면 닫힘, `'new'`면 등록, 계정이면 수정. */
  const [accountDialog, setAccountDialog] = useState<'new' | 'manage' | MailAccount | null>(null);

  const usersQuery = useUsers();
  const users = usersQuery.data ?? [];
  const actor = authenticatedUser
    ?? users.find((user) => user.id === demoUserId)
    ?? users.find((user) => user.status === '사용')
    ?? null;

  const accountsQuery = useMailAccounts(actor);
  const accounts = useMemo(() => accountsQuery.data ?? [], [accountsQuery.data]);

  /**
   * 선택 계정. 빈 배열이면 전체다.
   *
   * URL에 쉼표로 이어 둬 새로고침·뒤로가기에서 선택이 유지된다. 사라진 계정 ID는 걸러
   * 낸다 — 계정을 지운 뒤 예전 링크로 들어오면 아무 메일도 안 나오게 된다.
   */
  const accountParam = searchParams.get('accounts');
  const selectedAccountIds = useMemo(() => {
    if (!accountParam) return [];
    const known = accountParam.split(',').filter((id) => accounts.some((row) => row.id === id));
    return known.length === accounts.length ? [] : known;
  }, [accountParam, accounts]);

  /** 현재 폴더. 알 수 없는 값은 받은메일함으로 되돌린다. */
  const folderParam = searchParams.get('folder');
  const folder: MailFolder = MAIL_FOLDERS.includes(folderParam as MailFolder)
    ? (folderParam as MailFolder)
    : 'INBOX';

  /**
   * 검색어는 URL의 값만 조회에 쓴다.
   *
   * 입력할 때마다 조회하면 글자 하나에 IMAP 왕복이 계정 수만큼 일어난다. 제출했을 때만
   * URL이 바뀌고 그때 한 번 조회한다.
   */
  const searchTerm = searchParams.get('q') ?? '';
  const unseenOnly = searchParams.get('unseen') === '1';
  const flaggedOnly = searchParams.get('flag') === '1';
  const [searchInput, setSearchInput] = useState(searchTerm);
  useEffect(() => { setSearchInput(searchTerm); }, [searchTerm]);

  /** 계정당 조회 상한. `더 보기`가 키우고, 폴더·검색이 바뀌면 처음 값으로 돌아온다. */
  const [fetchLimit, setFetchLimit] = useState<number>(MAIL_FETCH_PER_ACCOUNT);
  const inboxQuery = useInbox(actor, selectedAccountIds, folder, {
    text: searchTerm,
    unseenOnly,
    flaggedOnly,
  }, fetchLimit);
  const mails = inboxQuery.data?.mails ?? [];
  const failures = inboxQuery.data?.failures ?? [];

  const foldersQuery = useMailFolders(actor, selectedAccountIds);
  const unseenQuery = useUnseenCount(actor);
  /** 선택한 계정 기준 안 읽은 수 합계. 전체 선택이면 전 계정을 더한다. */
  const unseenTotal = useMemo(() => {
    const counts = unseenQuery.data ?? {};
    const ids = selectedAccountIds.length > 0 ? selectedAccountIds : Object.keys(counts);
    return ids.reduce((sum, id) => sum + (counts[id] ?? 0), 0);
  }, [unseenQuery.data, selectedAccountIds]);
  /**
   * 선택한 계정 중 **하나라도** 가진 폴더는 열어 둔다. 계정마다 구성이 다를 수 있다.
   *
   * 서버는 폴더를 못 읽은 계정을 응답에서 **뺀다**(빈 배열이면 "폴더가 없는 계정"과 구분이
   * 안 되므로). 그래서 여기서 빠진 계정을 "폴더 없음"으로 읽으면 안 된다 — IMAP이 한 번
   * 흔들린 것뿐인데 보낸메일함·임시보관·휴지통이 전부 잠기고, 화면은 "연결한 계정에 이
   * 폴더가 없습니다"라고 엉뚱한 이유를 댄다. 아무 계정도 못 읽었으면 `null`(모름)로 두어
   * 잠그지 않는다.
   */
  const availableFolders = useMemo(() => {
    const map = foldersQuery.data;
    if (!map) return null;
    const ids = selectedAccountIds.length > 0 ? selectedAccountIds : Object.keys(map);
    const known = ids.filter((id) => map[id] !== undefined);
    if (known.length === 0) return null;
    const union = new Set<MailFolder>();
    for (const id of known) for (const item of map[id] ?? []) union.add(item);
    return [...union];
  }, [foldersQuery.data, selectedAccountIds]);

  const moveMail = useMoveMail();
  const download = useDownloadAttachment();
  const [downloadingIndex, setDownloadingIndex] = useState<number | null>(null);
  /** 이미지 첨부 미리보기. data URL로 만들어 모달에 띄운다. */
  const [imagePreview, setImagePreview] = useState<{ filename: string; url: string } | null>(null);
  const draftsQuery = useMailDrafts(actor);
  const removeDraft = useRemoveMailDraft();
  const drafts = useMemo(() => draftsQuery.data ?? [], [draftsQuery.data]);
  /** 이어쓰는 임시보관. `draft` 파라미터로 지정한다. */
  const editingDraft = useMemo(
    () => drafts.find((row) => row.id === searchParams.get('draft')) ?? null,
    [drafts, searchParams],
  );

  const mailKey = searchParams.get('mail');
  const selectedRef = mailKey ? parseMailRefKey(mailKey) : null;
  /** 상세에서 목록으로 돌아가지 않고 이웃 메일로 이동한다. 현재 목록 순서를 따른다. */
  const selectedIndex = mailKey ? mails.findIndex((row) => mailRefKey(row.ref) === mailKey) : -1;
  const prevMail = selectedIndex > 0 ? mails[selectedIndex - 1] : null;
  const nextMail = selectedIndex >= 0 && selectedIndex < mails.length - 1 ? mails[selectedIndex + 1] : null;
  const detailQuery = useMailDetail(actor, selectedRef);
  const markRead = useMarkMailRead();
  const markFlagged = useMarkFlagged();

  /** 일괄 처리용 선택. 폴더·검색·계정이 바뀌면 딴 목록의 선택이 남지 않게 비운다. */
  const [checkedKeys, setCheckedKeys] = useState<Set<string>>(new Set());
  useEffect(() => {
    setCheckedKeys(new Set());
    setFetchLimit(MAIL_FETCH_PER_ACCOUNT);
  }, [folder, searchTerm, unseenOnly, flaggedOnly, accountParam]);
  // 화면에 보이는 메일만 대상이다. 조회에서 사라진 항목의 키는 자연히 걸러진다.
  const checkedRefs = mails
    .filter((row) => checkedKeys.has(mailRefKey(row.ref)))
    .map((row) => row.ref);

  const toggleCheck = (key: string) => {
    setCheckedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleCheckAll = () => {
    const keys = mails.map((row) => mailRefKey(row.ref));
    setCheckedKeys((prev) => (keys.length > 0 && keys.every((key) => prev.has(key))
      ? new Set()
      : new Set(keys)));
  };

  const go = (params: Record<string, string>) => {
    setNotice('');
    setError('');
    setSearchParams(params);
  };

  /** 계정 선택·폴더·검색 조건은 화면을 옮겨도 유지한다. */
  const withContext = (params: Record<string, string>) => {
    const next = { ...params };
    if (accountParam) next.accounts = accountParam;
    if (folder !== 'INBOX') next.folder = folder;
    if (searchTerm) next.q = searchTerm;
    if (unseenOnly) next.unseen = '1';
    if (flaggedOnly) next.flag = '1';
    return next;
  };

  const openMail = (mail: MailSummary) => {
    go(withContext({ mail: mailRefKey(mail.ref) }));
    // 읽음 표시 실패는 사용자가 할 수 있는 일이 없어 조용히 넘긴다.
    if (!mail.seen && actor) markRead.mutate({ actor, refs: [mail.ref], seen: true });
  };

  /*
    `모두 읽음`은 제거했다(2026-08-24). 목록 전체를 한 번에 읽음 처리하면 되돌릴 방법이
    사실상 없고, 실수로 눌렀을 때 안 읽은 메일을 다시 찾아낼 수단이 없다.
    선택 후 일괄 `읽음`(아래 bulkMarkRead)이 같은 일을 범위를 좁혀 안전하게 한다.
  */

  /** 안 읽음 되돌리기. 목록으로 복귀한다 — 열어둔 채면 다시 읽음이 되는 것처럼 보인다. */
  const markUnread = async () => {
    if (!selectedRef) return;
    try {
      await markRead.mutateAsync({ actor: actor as User, refs: [selectedRef], seen: false });
      go(withContext({}));
      setNotice('안 읽음으로 표시했습니다.');
    } catch (caught) {
      setError(mailErrorText(caught, '안 읽음 표시를 반영하지 못했습니다.'));
    }
  };

  /** 휴지통에서 받은메일함으로 복원. */
  const restoreMail = async () => {
    if (!selectedRef) return;
    try {
      await moveMail.mutateAsync({ actor: actor as User, refs: [selectedRef], to: 'INBOX' });
      go(withContext({}));
      setNotice('메일을 받은메일함으로 되돌렸습니다.');
    } catch (caught) {
      setNotice('');
      setError(mailErrorText(caught, '메일을 옮기지 못했습니다.'));
    }
  };

  /** 선택한 메일들 읽음·안 읽음 일괄 표시. */
  const bulkMarkRead = async (seen: boolean) => {
    if (checkedRefs.length === 0) return;
    try {
      await markRead.mutateAsync({ actor: actor as User, refs: checkedRefs, seen });
      setCheckedKeys(new Set());
      setNotice(`${checkedRefs.length}건을 ${seen ? '읽음' : '안 읽음'}으로 표시했습니다.`);
    } catch (caught) {
      setError(mailErrorText(caught, '표시를 반영하지 못했습니다.'));
    }
  };

  /** 선택한 메일들 별표. 하나라도 별표가 없으면 전부 별표, 전부 있으면 해제. */
  const bulkFlag = async () => {
    if (checkedRefs.length === 0) return;
    const checkedMails = mails.filter((row) => checkedKeys.has(mailRefKey(row.ref)));
    const flagged = !checkedMails.every((row) => row.flagged);
    try {
      await markFlagged.mutateAsync({ actor: actor as User, refs: checkedRefs, flagged });
      setCheckedKeys(new Set());
      setNotice(`${checkedRefs.length}건을 ${flagged ? '중요로 표시했습니다' : '중요 해제했습니다'}.`);
    } catch (caught) {
      setError(mailErrorText(caught, '중요 표시를 반영하지 못했습니다.'));
    }
  };

  /** 선택한 메일들 일괄 이동. 일부 실패는 성공 건수와 함께 알린다. */
  const bulkMove = async (to: MailFolder) => {
    if (checkedRefs.length === 0) return;
    const result = await moveMail.mutateAsync({ actor: actor as User, refs: checkedRefs, to });
    setCheckedKeys(new Set());
    const label = to === 'TRASH' ? '휴지통으로 옮겼습니다' : '받은메일함으로 되돌렸습니다';
    if (result.failed === 0) {
      setNotice(`${result.moved}건을 ${label}.`);
    } else {
      setNotice('');
      setError(`${result.moved}건 처리, ${result.failed}건 실패했습니다. 새로고침 후 남은 메일을 확인하세요.`);
    }
  };

  const backToList = () => go(withContext({}));

  const selectAccounts = (ids: string[]) => {
    const next = withContext({});
    delete next.accounts;
    if (ids.length > 0) next.accounts = ids.join(',');
    go(next);
  };

  /** 폴더를 바꾸면 검색 조건은 지운다. 다른 폴더에서 검색 결과 0건이 나오면 폴더가 빈 것처럼 보인다. */
  const selectFolder = (next: MailFolder) => {
    const params: Record<string, string> = {};
    if (accountParam) params.accounts = accountParam;
    if (next !== 'INBOX') params.folder = next;
    go(params);
  };

  const submitSearch = (term: string) => {
    const next = withContext({});
    delete next.q;
    if (term.trim()) next.q = term.trim();
    go(next);
  };

  const toggleUnseen = () => {
    const next = withContext({});
    if (unseenOnly) delete next.unseen;
    else next.unseen = '1';
    go(next);
  };

  const toggleFlaggedOnly = () => {
    const next = withContext({});
    if (flaggedOnly) delete next.flag;
    else next.flag = '1';
    go(next);
  };

  /** 별표 토글. 목록에서 바로 누르므로 성공 안내는 띄우지 않는다 — 별이 바뀐 것이 안내다. */
  const toggleMailFlag = async (mail: MailSummary) => {
    try {
      await markFlagged.mutateAsync({ actor: actor as User, refs: [mail.ref], flagged: !mail.flagged });
    } catch (caught) {
      setError(mailErrorText(caught, '중요 표시를 반영하지 못했습니다.'));
    }
  };

  const closeComposer = () => {
    setCompose(null);
    setComposeTo(null);
    if (searchParams.get('draft')) go(withContext({}));
  };

  const openDraft = (id: string) => go(withContext({ draft: id }));

  const discardDraft = async (id: string) => {
    try {
      await removeDraft.mutateAsync({ actor: actor as User, id });
      setNotice('임시보관을 삭제했습니다.');
    } catch {
      setError('임시보관을 삭제하지 못했습니다.');
    }
  };

  const downloadAttachment = async (index: number) => {
    if (!selectedRef) return;
    setDownloadingIndex(index);
    try {
      const content = await download.mutateAsync({ actor: actor as User, ref: selectedRef, index });
      saveAttachment(content);
    } catch (caught) {
      setError(mailErrorText(caught, '첨부를 내려받지 못했습니다.'));
    } finally {
      setDownloadingIndex(null);
    }
  };

  /** 이미지 첨부 미리보기 — 내려받기와 같은 경로로 받아 저장 대신 화면에 띄운다. */
  const previewAttachment = async (index: number) => {
    if (!selectedRef) return;
    setDownloadingIndex(index);
    try {
      const content = await download.mutateAsync({ actor: actor as User, ref: selectedRef, index });
      setImagePreview({ filename: content.filename, url: `data:${content.contentType};base64,${content.base64}` });
    } catch (caught) {
      setError(mailErrorText(caught, '첨부를 불러오지 못했습니다.'));
    } finally {
      setDownloadingIndex(null);
    }
  };

  /** 휴지통으로 이동. 이미 휴지통에 있으면 버튼을 내리므로 여기 오지 않는다. */
  const trashMail = async () => {
    if (!selectedRef) return;
    try {
      await moveMail.mutateAsync({ actor: actor as User, refs: [selectedRef], to: 'TRASH' });
      go(withContext({}));
      setNotice('메일을 휴지통으로 옮겼습니다.');
    } catch (caught) {
      setNotice('');
      setError(mailErrorText(caught, '메일을 옮기지 못했습니다.'));
    }
  };

  if (usersQuery.isLoading || accountsQuery.isLoading) {
    return <div className="grid min-h-[calc(60vh/var(--font-scale,1))] place-items-center text-[12px] font-semibold text-ink3">메일함을 불러오는 중…</div>;
  }
  if (!actor) {
    return <div className="grid min-h-[calc(60vh/var(--font-scale,1))] place-items-center text-[12px] font-semibold text-ink3">사용자 정보를 불러올 수 없습니다.</div>;
  }

  const detailAccount = selectedRef
    ? accounts.find((row) => row.id === selectedRef.accountId)
    : undefined;

  return (
    <div className="mx-auto w-full max-w-[1400px] px-4 py-5 sm:px-6 sm:py-6">
      <GwHead
        icon="✉️"
        name="메일"
        right={
          <div className="flex items-center gap-2">
            {!authenticatedUser && (
              <select
                value={actor.id}
                onChange={(event) => { setDemoUserId(event.target.value); go({}); }}
                title="사용자 선택"
                className="h-9 rounded-lg border border-amber/30 bg-amber-soft/30 px-3 text-[10.5px] font-bold text-ink outline-none"
              >
                {users.filter((user) => user.status === '사용').map((user) => (
                  <option key={user.id} value={user.id}>{user.name} · {user.position || user.dept || '사원'}</option>
                ))}
              </select>
            )}
            <Button disabled={inboxQuery.isFetching} onClick={() => { void inboxQuery.refetch(); }}>
              {inboxQuery.isFetching ? '불러오는 중…' : '새로고침'}
            </Button>
            {/*
              계정 등록·수정·해제는 메일 Function이 처리한다. 예전에는 MailHub 브리지가
              계정 관리를 지원하지 않아 서버가 붙으면 이 버튼을 잠갔는데, 그러면 정작
              연결이 된 상태에서 계정을 손댈 수 없었다.
            */}
            <Button title="메일 계정 관리" onClick={() => setAccountDialog('manage')}>
              계정 관리
            </Button>
            <Button variant="primary" disabled={accounts.length === 0} onClick={() => { setNotice(''); setCompose('new'); }}>
              + 메일 쓰기
            </Button>
          </div>
        }
      />

      {notice && <div className="mt-4 rounded-lg border border-teal/20 bg-teal-soft/25 px-3 py-2.5 text-[11px] font-semibold text-teal">{notice}</div>}
      {error && <div className="mt-4 rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2.5 text-[11px] font-semibold text-red-500">{error}</div>}

      {accounts.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            {/* 설정 진입 — 브리지 모드에서는 계정을 못 고치는 대신 서명 편집 모달이 열린다. */}
            <MailAccountPicker
              accounts={accounts}
              selected={selectedAccountIds}
              onChange={selectAccounts}
              failedIds={failures.map((row) => row.accountId)}
              onEdit={(account) => setAccountDialog(account)}
            />
            {/*
              메일 서버 연결이 끊긴 상태만 알린다.
              연결이 정상일 때는 아무 말도 하지 않는다 — 잘 되고 있다는 안내는 화면만
              어지럽힌다. 반대로 연결이 없으면 화면의 메일이 실제가 아니므로 반드시 알린다.
              ([[jwheo/feat/mail/DESIGN.md]] §1 사용 전제 · §15)
            */}
            {isMailSampleData && (
              <span
                title="화면 확인용 샘플 데이터입니다. 실제 메일이 아니며 발송되지 않습니다."
                className="shrink-0 rounded-full bg-amber/15 px-2 py-1 text-[9.5px] font-bold text-amber"
              >
                샘플 데이터
              </span>
            )}
          </div>
          <form
            onSubmit={(event) => { event.preventDefault(); submitSearch(searchInput); }}
            className="flex items-center gap-1.5"
          >
            <input
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="제목·이름·본문 검색"
              className="h-9 w-52 rounded-lg border border-border bg-panel px-3 text-[10.5px] text-ink outline-none"
            />
            <button type="submit" className="h-9 rounded-lg border border-border px-3 text-[10.5px] font-bold text-ink2 hover:bg-ink3/8">
              검색
            </button>
            {searchTerm && (
              <button type="button" onClick={() => submitSearch('')} className="h-9 rounded-lg px-2 text-[10.5px] font-bold text-ink3 hover:text-teal">
                해제
              </button>
            )}
            <button
              type="button"
              onClick={toggleUnseen}
              className={`h-9 rounded-lg border px-3 text-[10.5px] font-bold transition-colors ${unseenOnly ? 'border-teal bg-teal-soft/40 text-teal' : 'border-border text-ink2 hover:bg-ink3/8'}`}
            >
              안 읽음만
            </button>
            <button
              type="button"
              onClick={toggleFlaggedOnly}
              className={`h-9 rounded-lg border px-3 text-[10.5px] font-bold transition-colors ${flaggedOnly ? 'border-amber bg-amber-soft/40 text-amber' : 'border-border text-ink2 hover:bg-ink3/8'}`}
            >
              ★ 중요만
            </button>
          </form>
        </div>
      )}

      {accounts.length > 0 && (
        <div className="mt-2 text-[10px] text-ink3">
          {/* 임시보관은 로컬 저장분도 목록에 있으므로 함께 센다. */}
          {inboxQuery.isFetching
            ? '불러오는 중…'
            : `${MAIL_FOLDER_LABELS[folder]} ${folder === 'DRAFTS' ? mails.length + drafts.length : mails.length}건`}
          {searchTerm && <span className="ml-2 text-ink2">검색어 “{searchTerm}”</span>}
          {unseenOnly && <span className="ml-2 text-ink2">안 읽음만</span>}
          {failures.length > 0 && (
            <span className="ml-2 text-amber">
              {failures.length}개 계정 조회 실패 · {MAIL_ERROR_GUIDE[failures[0].code]}
            </span>
          )}
        </div>
      )}

      {accounts.length > 0 && folder !== 'DRAFTS' && checkedRefs.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5 rounded-lg border border-teal/25 bg-teal-soft/20 px-3 py-2">
          <span className="mr-1 text-[10.5px] font-bold text-teal">{checkedRefs.length}건 선택</span>
          <Button size="sm" disabled={markRead.isPending} onClick={() => { void bulkMarkRead(true); }}>읽음</Button>
          <Button size="sm" disabled={markRead.isPending} onClick={() => { void bulkMarkRead(false); }}>안 읽음</Button>
          <Button size="sm" disabled={markFlagged.isPending} onClick={() => { void bulkFlag(); }}>★ 중요</Button>
          {folder === 'TRASH' ? (
            <Button size="sm" disabled={moveMail.isPending} onClick={() => { void bulkMove('INBOX'); }}>
              {moveMail.isPending ? '옮기는 중…' : '받은메일함으로'}
            </Button>
          ) : (
            <Button size="sm" variant="danger" disabled={moveMail.isPending} onClick={() => { void bulkMove('TRASH'); }}>
              {moveMail.isPending ? '옮기는 중…' : '휴지통으로'}
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={() => setCheckedKeys(new Set())}>선택 해제</Button>
        </div>
      )}

      {accountsQuery.isError ? (
        /*
          계정이 0개인 것과 "목록을 못 불러온 것"은 다르다. 뭉뚱그리면 실제로는 연결된
          계정이 있는데도 "신규 연결" 화면으로 떨어져 사용자가 이미 등록한 계정을 다시
          등록하려 들거나 계정이 사라졌다고 오해한다. (2026-08-26 실사고 — 위디 토큰
          만료로 목록 조회가 401이 됐을 때 이 화면이 뜸)
        */
        <div className="mt-5 rounded-xl border border-dashed border-red-500/30 bg-red-500/5 px-6 py-12 text-center">
          <div className="text-2xl">⚠️</div>
          <div className="mt-2 text-[12px] font-bold text-ink">메일 계정 목록을 불러오지 못했습니다.</div>
          <div className="mt-1 text-[10.5px] text-ink3">{mailErrorText(accountsQuery.error)}</div>
          <div className="mt-3">
            <Button variant="primary" disabled={accountsQuery.isFetching} onClick={() => { void accountsQuery.refetch(); }}>
              {accountsQuery.isFetching ? '다시 불러오는 중…' : '다시 시도'}
            </Button>
          </div>
        </div>
      ) : accounts.length === 0 ? (
        <div className="mt-5 rounded-xl border border-dashed border-border bg-panel px-6 py-12 text-center">
          <div className="text-2xl">📮</div>
          <div className="mt-2 text-[12px] font-bold text-ink">연결된 메일 계정이 없습니다.</div>
          <div className="mt-1 text-[10.5px] text-ink3">네이버·다음 계정을 연결하면 받은메일을 한곳에서 볼 수 있습니다.</div>
          <div className="mt-3">
            <Button variant="primary" onClick={() => setAccountDialog('new')}>메일 계정 연결</Button>
          </div>
        </div>
      ) : (
        <div className="mt-4 grid items-start gap-4 lg:grid-cols-[240px_minmax(300px,380px)_1fr]">
          {/* 폴더 — 좁은 화면에서는 상세를 볼 때 감춘다 */}
          <div className={selectedRef ? 'hidden lg:block' : ''}>
            <MailFolderNav
              current={folder}
              available={availableFolders}
              onSelect={selectFolder}
              unseenCount={unseenTotal}
              draftCount={drafts.length}
            />
          </div>

          {/* 목록 — 임시보관은 로컬과 서버 두 곳에 나뉘어 있어 다른 목록을 쓴다 */}
          <section className={`flex min-h-[420px] flex-col overflow-hidden rounded-xl border border-border bg-panel shadow-sm ${selectedRef ? 'hidden lg:flex' : ''}`}>
            <div className="flex min-h-0 flex-1 flex-col">
              {folder === 'DRAFTS' ? (
                inboxQuery.isLoading ? (
                  <div className="grid h-full place-items-center text-[11px] text-ink3">임시보관을 불러오는 중…</div>
                ) : (
                  <MailDraftList
                    drafts={drafts}
                    accounts={accounts}
                    onOpen={openDraft}
                    onDiscard={discardDraft}
                    serverDrafts={mails}
                    selectedKey={mailKey}
                    onSelectServer={openMail}
                  />
                )
              ) : inboxQuery.isLoading ? (
                <div className="grid h-full place-items-center text-[11px] text-ink3">메일을 불러오는 중…</div>
              ) : (
                <MailList
                  mails={mails}
                  failures={failures}
                  accounts={accounts}
                  selectedKey={mailKey}
                  onSelect={openMail}
                  folderLabel={MAIL_FOLDER_LABELS[folder]}
                  filtered={searchTerm !== '' || unseenOnly || flaggedOnly}
                  checkedKeys={checkedKeys}
                  onToggleCheck={toggleCheck}
                  onToggleAll={toggleCheckAll}
                  onToggleFlag={toggleMailFlag}
                />
              )}
            </div>
            {/*
              받아온 만큼 다 찼을 때만 보인다. 덜 찼으면 그 뒤가 없다는 뜻이다.
              임시보관도 서버 목록을 그리므로 여기서 제외하지 않는다.
            */}
            {!inboxQuery.isLoading && mails.length >= fetchLimit && fetchLimit < MAIL_FETCH_PER_ACCOUNT_MAX && (
              <div className="border-t border-border p-2 text-center">
                <Button
                  size="sm"
                  disabled={inboxQuery.isFetching}
                  onClick={() => setFetchLimit((value) => Math.min(value + MAIL_FETCH_PER_ACCOUNT, MAIL_FETCH_PER_ACCOUNT_MAX))}
                >
                  {inboxQuery.isFetching ? '불러오는 중…' : '더 보기'}
                </Button>
              </div>
            )}
          </section>

          {/* 상세 */}
          <section className={`min-h-[420px] overflow-hidden rounded-xl border border-border bg-panel shadow-sm ${selectedRef ? '' : 'hidden lg:block'}`}>
            <MailDetail
              detail={detailQuery.data}
              account={detailAccount}
              loading={detailQuery.isLoading}
              error={detailQuery.error}
              onBack={backToList}
              onReply={(mode) => { setNotice(''); setCompose(mode); }}
              onForward={() => { setNotice(''); setCompose('forward'); }}
              onPrev={prevMail ? () => openMail(prevMail) : undefined}
              onNext={nextMail ? () => openMail(nextMail) : undefined}
              onComposeTo={(address) => { setNotice(''); setComposeTo([address]); setCompose('new'); }}
              onTrash={folder === 'TRASH' ? undefined : trashMail}
              onRestore={folder === 'TRASH' ? restoreMail : undefined}
              trashing={moveMail.isPending}
              onMarkUnread={markUnread}
              markingUnread={markRead.isPending}
              onDownload={downloadAttachment}
              onPreview={(index) => { void previewAttachment(index); }}
              downloadingIndex={downloadingIndex}
            />
          </section>
        </div>
      )}

      {(compose || editingDraft) && (
        <MailComposer
          key={editingDraft?.id ?? compose ?? 'new'}
          actor={actor}
          accounts={accounts}
          mode={compose ?? 'new'}
          source={compose && compose !== 'new' ? detailQuery.data ?? null : null}
          draft={editingDraft}
          initialTo={composeTo ?? undefined}
          initialAccountId={
            // 답장·전달은 원본을 받은 계정으로 보낸다. 새 메일은 정상 계정 우선.
            (compose && compose !== 'new' && selectedRef?.accountId)
            || accounts.find((row) => row.status === 'active')?.id
            || accounts[0].id
          }
          onClose={closeComposer}
          onSent={(message) => { closeComposer(); setNotice(message); }}
          onSaved={(message) => { closeComposer(); setNotice(message); }}
        />
      )}

      {imagePreview && (
        <Modal open onClose={() => setImagePreview(null)} title={imagePreview.filename} width={Math.min(880, window.innerWidth - 32)}>
          <img src={imagePreview.url} alt={imagePreview.filename} className="mx-auto max-h-[calc(70vh/var(--font-scale,1))] max-w-full rounded-lg" />
        </Modal>
      )}

      {accountDialog === 'manage' ? (
        <MailAccountManageDialog
          actor={actor}
          accounts={accounts}
          onAdd={() => setAccountDialog('new')}
          onEdit={(account) => setAccountDialog(account)}
          onClose={() => setAccountDialog(null)}
          onDone={(message) => { go({}); setNotice(message); }}
        />
      ) : accountDialog ? (
        /*
          등록·수정 모두 같은 모달을 쓴다. 예전에는 서버가 붙으면 수정이 서명 전용 모달로
          빠졌는데, 브리지가 자격 증명을 못 고쳤기 때문이다. Function은 앱 비밀번호 교체까지
          지원하므로 그 분기를 없앤다.
        */
        <MailAccountDialog
          actor={actor}
          account={accountDialog === 'new' ? null : accountDialog}
          onClose={() => setAccountDialog(null)}
          // go()가 안내 문구를 지우므로 이동을 먼저 하고 문구를 넣는다.
          onDone={(message) => { setAccountDialog(null); go({}); setNotice(message); }}
        />
      ) : null}
    </div>
  );
}

export default function MailScreen() {
  // 메일은 Firestore가 아니라 메일 서버에 붙는다. Firebase 설정 여부로 가르면 안 된다.
  if (isMailBackendReady || isMailSampleData) return <LocalMailScreen />;
  return <MailBackendMissing />;
}
