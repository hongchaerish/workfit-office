import { useEffect, useMemo, useState } from 'react';
import { useCanDesignate } from '@/features/auth/useCanDesignate';
import type { User } from '@/domain/user/schema';
import type { MailAccount } from '@/domain/mailAccount/schema';
import {
  composeDraft,
  formatAddressList,
  mailErrorText,
  mergeRecipientSources,
  parseAddressList,
  type ComposeDraft,
} from '@/domain/mail/engine';
import { useUsers } from '@/features/user/useUsers';
import {
  MAIL_BODY_MAX,
  MAIL_OUTGOING_TOTAL_MAX,
  type MailAddress,
  type MailComposeMode,
  type MailDetail,
  type MailDraft,
  type MailOrigin,
  type OutgoingAttachment,
} from '@/domain/mail/schema';
import { nextDraftId } from '@/data/mail/draft.store';
import { recipientStore } from '@/data/mail/recipient.store';
import { useRemoveMailDraft, useSaveMailDraft } from '@/features/mail/useMailDrafts';
import { useSendMail } from '@/features/mail/useMailbox';
import { Button } from '@/shared/ui/Button';
import { Modal } from '@/shared/ui/Modal';
import MailAddressField from './MailAddressField';
import { ErrorNotice } from '@/shared/ui/ErrorNotice';

const MODE_TITLE: Record<MailComposeMode, string> = {
  new: '새 메일',
  reply: '답장',
  replyAll: '전체답장',
  forward: '전달',
};

/** 첨부 크기 표기. 상세 화면과 같은 규칙이다. */
function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(0)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

/** 파일을 base64로 읽는다. data URL 접두(`data:...;base64,`)는 떼어낸다. */
function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',', 2)[1] ?? '');
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

interface Props {
  actor: User;
  accounts: MailAccount[];
  mode: MailComposeMode;
  /** 답장·전달의 원본. 새 메일이면 없다. */
  source: MailDetail | null;
  /** 이어쓰는 임시보관. 있으면 초기값 대신 이 내용으로 연다. */
  draft?: MailDraft | null;
  /** 발신 계정 초기값. 답장은 원본을 받은 계정을 쓴다. */
  initialAccountId: string;
  /** 새 메일의 받는 사람 초기값. 상세의 보낸사람 주소 클릭이 넘긴다. */
  initialTo?: MailAddress[];
  onClose: () => void;
  onSent: (message: string) => void;
  onSaved: (message: string) => void;
}

/**
 * 메일 작성.
 *
 * 초기값 계산(수신자·제목·인용문)은 `composeDraft` 순수함수가 맡는다. 화면에 두면 모드가
 * 늘 때마다 조건문이 흩어지고 렌더 없이는 확인할 수 없다.
 */
export default function MailComposer({ actor, accounts, mode, source, draft, initialAccountId, initialTo, onClose, onSent, onSaved }: Props) {
  const send = useSendMail();
  const saveDraft = useSaveMailDraft();
  const removeDraft = useRemoveMailDraft();
  const [accountId, setAccountId] = useState(draft?.accountId ?? initialAccountId);
  const [showCc, setShowCc] = useState((draft?.cc.length ?? 0) > 0 || (draft?.bcc.length ?? 0) > 0);
  const [error, setError] = useState('');
  /** 이 화면에서 만든/이어쓰는 임시보관 ID. 저장을 여러 번 눌러도 하나만 남는다. */
  const [draftId, setDraftId] = useState<string | null>(draft?.id ?? null);
  const [attachments, setAttachments] = useState<OutgoingAttachment[]>([]);
  /** 첨부파일 보존기한 (기본: 영구보존) */
  const [attachmentRetention, setAttachmentRetention] = useState<'permanent' | '30d' | '90d' | '180d' | '1y'>('permanent');
  /** 파일을 base64로 읽는 동안 보내기를 막는다. 읽다 만 채로 보내면 첨부가 빠진다. */
  const [readingFiles, setReadingFiles] = useState(false);
  /** 파일을 끌고 들어온 상태. 놓을 자리를 표시한다. */
  const [dragging, setDragging] = useState(false);
  /** 사용자가 입력을 고쳤는지. 초기값 그대로면 자동 저장하지 않는다. */
  const [dirty, setDirty] = useState(false);
  const [lastAutoSavedAt, setLastAutoSavedAt] = useState<string | null>(null);


  const account = accounts.find((row) => row.id === accountId);
  const selfEmails = useMemo(() => accounts.map((row) => row.email), [accounts]);
  /** 최근 받는 사람. 이 모달이 열릴 때 한 번 읽으면 충분하다. */
  const recentRecipients = useMemo(() => recipientStore.list(actor.id), [actor.id]);
  /** 추천 후보 = 최근 주소 + 사내 주소록(재직자). 최근 사용이 앞선다. */
  const usersQuery = useUsers();
  const { canDesignate } = useCanDesignate();
  const suggestionSource = useMemo(() => mergeRecipientSources(
    recentRecipients,
    (usersQuery.data ?? [])
      .filter((row) => row.status === '사용' && canDesignate(row))
      .map((row) => ({ name: row.name, email: row.email })),
  ), [recentRecipients, usersQuery.data, canDesignate]);

  // 발신 계정이 바뀌면 서명도 바뀌어야 하지만, 본문을 이미 쓴 뒤 갈아끼우면 사용자가 쓴
  // 내용을 건드리게 된다. 초기값은 처음 계정 기준으로 한 번만 만든다.
  const initial: ComposeDraft = useMemo(
    () => {
      // 이어쓰기면 저장된 내용이 초기값을 대신한다.
      if (draft) {
        return {
          to: draft.to,
          cc: draft.cc,
          bcc: draft.bcc,
          subject: draft.subject,
          textBody: draft.textBody,
        };
      }
      const base = composeDraft(
        mode,
        accounts.find((row) => row.id === initialAccountId)?.signature ?? '',
        source ? { detail: source, selfEmails } : undefined,
      );
      // 보낸사람 주소 클릭으로 열린 새 메일. 받는 사람만 채우고 나머지는 새 메일 그대로다.
      return mode === 'new' && initialTo && initialTo.length > 0 ? { ...base, to: initialTo } : base;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const [to, setTo] = useState(formatAddressList(initial.to));
  const [cc, setCc] = useState(formatAddressList(initial.cc));
  const [bcc, setBcc] = useState(formatAddressList(initial.bcc));
  const [subject, setSubject] = useState(initial.subject);
  const [body, setBody] = useState(initial.textBody);

  const origin: MailOrigin | null = draft?.origin
    ?? (source && mode !== 'new' ? { ref: source.ref, mode } : null);

  /**
   * 닫기 — 고친 내용이 있으면 임시보관에 남기고 닫는다.
   *
   * 자동 저장은 입력이 멈추고 3초 뒤에 도니, 쓰자마자 닫으면 그 틈의 내용이 사라진다.
   * 저장 실패는 조용히 넘긴다 — 닫으려는 사람을 붙잡고 오류를 보여줘도 할 수 있는 일이 없다.
   */
  const handleClose = async () => {
    if (!dirty) {
      onClose();
      return;
    }
    try {
      await persistDraft();
      onSaved('쓰던 내용을 임시보관에 저장했습니다.');
    } catch {
      onClose();
    }
  };

  const attachedBytes = attachments.reduce((sum, file) => sum + file.size, 0);

  const addFiles = async (list: FileList | null) => {
    if (!list || list.length === 0) return;
    setError('');
    setReadingFiles(true);
    try {
      const added: OutgoingAttachment[] = [];
      for (const file of Array.from(list)) {
        added.push({
          filename: file.name,
          contentType: file.type || 'application/octet-stream',
          size: file.size,
          base64: await readAsBase64(file),
        });
      }
      const nextTotal = attachedBytes + added.reduce((sum, file) => sum + file.size, 0);
      if (nextTotal > MAIL_OUTGOING_TOTAL_MAX) {
        setError('첨부 총량이 20MB를 넘습니다. 큰 파일은 빼거나 줄여 주세요.');
        return;
      }
      setAttachments((rows) => [...rows, ...added]);
    } catch {
      setError('파일을 읽지 못했습니다. 다시 시도해 주세요.');
    } finally {
      setReadingFiles(false);
    }
  };

  /**
   * 임시보관 저장.
   *
   * 발송과 달리 받는 사람이 없어도 저장한다. 쓰다 만 메일을 남기는 것이 목적이라
   * 발송 검증을 걸면 저장 자체가 막힌다. 잘못된 주소도 입력한 그대로 남긴다.
   */
  const persistDraft = async (): Promise<void> => {
    const id = draftId ?? nextDraftId();
    await saveDraft.mutateAsync({
      actor,
      draft: {
        id,
        accountId,
        to: parseAddressList(to).addresses,
        cc: parseAddressList(cc).addresses,
        bcc: parseAddressList(bcc).addresses,
        subject,
        textBody: body,
        origin,
        updatedAt: new Date().toISOString(),
      },
    });
    setDraftId(id);
  };

  const saveAsDraft = async () => {
    setError('');
    try {
      await persistDraft();
      // 첨부는 임시보관에 넣지 않는다. localStorage 용량(수 MB)이 첨부 한 개로 넘친다.
      onSaved(attachments.length > 0 ? '임시보관에 저장했습니다. 첨부는 저장되지 않습니다.' : '임시보관에 저장했습니다.');
    } catch {
      setError('임시보관에 저장하지 못했습니다.');
    }
  };

  /**
   * 자동 저장 — 입력이 멈추고 3초 뒤 조용히 저장한다.
   *
   * 초기값 그대로면 저장하지 않는다(답장을 열었다 닫기만 해도 임시보관이 쌓인다).
   * 실패도 조용히 넘긴다 — 타이핑 중 오류 표시는 방해만 되고, 수동 저장과 발송이
   * 각자 실패를 알린다. 발송 중에는 걸지 않는다. 발송 성공 후 임시보관 삭제와
   * 경쟁하면 지운 임시보관이 되살아난다.
   */
  useEffect(() => {
    if (!dirty || send.isPending) return undefined;
    const timer = setTimeout(() => {
      persistDraft()
        .then(() => setLastAutoSavedAt(new Date().toTimeString().slice(0, 5)))
        .catch(() => undefined);
    }, 3000);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty, to, cc, bcc, subject, body, accountId, send.isPending]);

  const submit = async () => {
    setError('');
    const parsedTo = parseAddressList(to);
    const parsedCc = parseAddressList(cc);
    const parsedBcc = parseAddressList(bcc);
    const invalid = [...parsedTo.invalid, ...parsedCc.invalid, ...parsedBcc.invalid];
    if (invalid.length > 0) {
      setError(`메일 주소 형식이 아닙니다: ${invalid.join(', ')}`);
      return;
    }
    if (parsedTo.addresses.length === 0) {
      setError('받는 사람을 입력하세요.');
      return;
    }

    try {
      await send.mutateAsync({
        actor,
        input: {
          accountId,
          to: parsedTo.addresses,
          cc: parsedCc.addresses,
          bcc: parsedBcc.addresses,
          subject,
          textBody: body,
          origin,
          attachments,
        },
      });
      // 보낸 주소를 기억해 다음 작성에서 추천한다. 실패해도 발송은 이미 성공이다.
      recipientStore.record(actor.id, [...parsedTo.addresses, ...parsedCc.addresses, ...parsedBcc.addresses]);
      // 보냈으면 임시보관에 남길 이유가 없다. 남겨두면 같은 메일을 두 번 보내게 된다.
      if (draftId) await removeDraft.mutateAsync({ actor, id: draftId });
      onSent(`${formatAddressList(parsedTo.addresses)} 에게 메일을 보냈습니다.`);
    } catch (caught) {
      setError(mailErrorText(caught, '메일을 보내지 못했습니다.'));
    }
  };

  return (
    <Modal
      open
      onClose={() => { void handleClose(); }}
      title={MODE_TITLE[mode]}
      width={720}
      footer={
        <div className="flex w-full items-center justify-between gap-2">
          <span className="text-[9.5px] text-ink3">
            {[
              'Ctrl+Enter 보내기',
              account?.signature.trim() ? '서명이 본문 아래에 함께 나갑니다.' : '',
              lastAutoSavedAt ? `${lastAutoSavedAt} 자동 저장됨` : '',
            ].filter(Boolean).join(' · ')}
          </span>
          <div className="flex items-center gap-1.5">
            <Button onClick={() => { void handleClose(); }}>닫기</Button>
            <Button disabled={saveDraft.isPending || send.isPending} onClick={saveAsDraft}>
              {saveDraft.isPending ? '저장 중…' : '임시보관'}
            </Button>
            <Button variant="primary" disabled={send.isPending || readingFiles} onClick={submit}>
              {send.isPending ? '보내는 중…' : '보내기'}
            </Button>
          </div>
        </div>
      }
    >
      {/* 파일은 모달 어디에 놓아도 첨부된다. 좁은 버튼 위에만 놓게 하면 절반은 빗나간다. */}
      <div
        className="space-y-2.5"
        // 어느 입력칸에 있든 Ctrl(⌘)+Enter로 보낸다. 파일을 읽는 중이면 첨부가 빠지므로 막는다.
        onKeyDown={(event) => {
          if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !send.isPending && !readingFiles) {
            event.preventDefault();
            void submit();
          }
        }}
        onDragOver={(event) => {
          if (event.dataTransfer.types.includes('Files')) {
            event.preventDefault();
            setDragging(true);
          }
        }}
        onDragLeave={(event) => {
          if (event.currentTarget === event.target) setDragging(false);
        }}
        onDrop={(event) => {
          if (event.dataTransfer.types.includes('Files')) {
            event.preventDefault();
            setDragging(false);
            void addFiles(event.dataTransfer.files);
          }
        }}
      >
        {error && <ErrorNotice message={error} />}

          <label className="block">
            <span className="mb-1 block text-[10px] font-bold text-ink3">보내는 계정</span>
            <select
              value={accountId}
              onChange={(event) => setAccountId(event.target.value)}
              className="w-full rounded-lg border border-border bg-panel px-3 py-2 text-[11.5px] text-ink outline-none"
            >
              {accounts.map((row) => (
                <option key={row.id} value={row.id} disabled={row.status !== 'active'}>
                  {row.displayName} · {row.email}{row.status !== 'active' ? ' (연결 오류)' : ''}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="mb-1 flex items-center justify-between text-[10px] font-bold text-ink3">
              받는 사람
              <button type="button" onClick={() => setShowCc((value) => !value)} className="font-bold text-teal hover:underline">
                {showCc ? '참조 숨기기' : '참조·숨은참조'}
              </button>
            </span>
            <MailAddressField
              value={to}
              onChange={(next) => { setTo(next); setDirty(true); }}
              recents={suggestionSource}
              placeholder="name@example.com, 홍길동 <gil@example.com>"
            />
          </label>

          {showCc && (
            <>
              <label className="block">
                <span className="mb-1 block text-[10px] font-bold text-ink3">참조</span>
                <MailAddressField value={cc} onChange={(next) => { setCc(next); setDirty(true); }} recents={suggestionSource} />
              </label>
              <label className="block">
                <span className="mb-1 block text-[10px] font-bold text-ink3">숨은참조</span>
                <MailAddressField value={bcc} onChange={(next) => { setBcc(next); setDirty(true); }} recents={suggestionSource} />
                <span className="mt-1 block text-[9.5px] text-ink3">숨은참조에 넣은 주소는 받는 사람과 참조에 표시되지 않습니다.</span>
              </label>
            </>
          )}

          <label className="block">
            <span className="mb-1 block text-[10px] font-bold text-ink3">제목</span>
            <input value={subject} onChange={(event) => { setSubject(event.target.value); setDirty(true); }} className="w-full rounded-lg border border-border bg-panel px-3 py-2 text-[11.5px] text-ink outline-none" />
          </label>

          <label className="block">
            <span className="mb-1 flex items-center justify-between text-[10px] font-bold text-ink3">
              본문
              <span className="font-semibold text-ink3">{body.length.toLocaleString()} / {MAIL_BODY_MAX.toLocaleString()}</span>
            </span>
            <textarea
              value={body}
              onChange={(event) => { setBody(event.target.value.slice(0, MAIL_BODY_MAX)); setDirty(true); }}
              rows={12}
              className="w-full resize-y rounded-lg border border-border bg-panel px-3 py-2 text-[11.5px] leading-relaxed text-ink outline-none"
            />
          </label>

          <div>
            <div className="mb-1 flex flex-wrap items-center justify-between gap-2 text-[10px] font-bold text-ink3">
              <span className="flex items-center gap-2">
                <span>첨부</span>
                <span className="font-semibold">
                  {attachments.length > 0 ? `${attachments.length}개 · ${formatBytes(attachedBytes)} / 20 MB` : '총 20MB까지'}
                </span>
              </span>

              {/* 보존기한 설정 드롭다운 */}
              <div className="flex items-center gap-1.5 font-normal">
                <span className="text-[10px] text-ink3">보존기한:</span>
                <select
                  value={attachmentRetention}
                  onChange={(e) => setAttachmentRetention(e.target.value as any)}
                  className="rounded border border-border bg-panel-alt/60 px-1.5 py-0.5 text-[10.5px] font-bold text-teal outline-none"
                >
                  <option value="permanent">영구 보존 (기본)</option>
                  <option value="30d">30일 (단기 보관)</option>
                  <option value="90d">90일 (3개월)</option>
                  <option value="180d">180일 (6개월)</option>
                  <option value="1y">1년 (365일)</option>
                </select>
                {attachmentRetention !== 'permanent' && (
                  <span className="rounded bg-amber-soft/50 px-1.5 py-0.5 text-[9.5px] font-bold text-amber">
                    기한 만료 시 자동 삭제
                  </span>
                )}
              </div>
            </div>

            {attachments.length > 0 && (
              <ul className="mb-2 space-y-1">
                {attachments.map((file, index) => (
                  <li key={`${file.filename}-${index}`} className="flex items-center gap-2 rounded-lg border border-border px-2.5 py-1.5">
                    <span className="shrink-0 text-[11px]">📎</span>
                    <span className="min-w-0 flex-1 truncate text-[11px] text-ink">{file.filename}</span>
                    <span className="shrink-0 text-[9.5px] text-ink3">{formatBytes(file.size)}</span>
                    <button
                      type="button"
                      onClick={() => setAttachments((rows) => rows.filter((_, at) => at !== index))}
                      className="shrink-0 text-[10px] font-bold text-ink3 hover:text-danger"
                    >
                      제거
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <label className={`inline-flex cursor-pointer items-center gap-1.5 rounded-lg border px-3 py-2 text-[10.5px] font-bold transition-colors ${dragging ? 'border-teal bg-teal-soft/40 text-teal' : 'border-border text-ink2 hover:bg-ink3/8'}`}>
              📎 {dragging ? '여기에 놓으면 첨부됩니다' : '파일 첨부 (끌어다 놓기 가능)'}
              <input
                type="file"
                multiple
                className="hidden"
                onChange={(event) => { void addFiles(event.target.files); event.target.value = ''; }}
              />
            </label>
            {readingFiles && <span className="ml-2 text-[9.5px] text-ink3">파일을 읽는 중…</span>}
          </div>

        {account && account.signature.trim() === '' && (
          <div className="text-[9.5px] text-ink3">이 계정에는 서명이 없습니다. 계정 목록의 &lsquo;설정&rsquo;에서 등록할 수 있습니다.</div>
        )}
      </div>
    </Modal>
  );
}
