import { useState } from 'react';
import type { User } from '@/domain/user/schema';
import {
  MAIL_PROVIDER_PRESETS,
  mailProviderPreset,
  type MailAccount,
  type MailProvider,
} from '@/domain/mailAccount/schema';
import { mailErrorText } from '@/domain/mail/engine';
import {
  MOCK_CREDENTIAL,
  useCreateMailAccount,
  useDeleteMailAccount,
  useTestMailConnection,
  useUpdateMailAccount,
} from '@/features/mail/useMailAccounts';
import { isConnectionOk, type MailCredential } from '@/data/mail/mail.gateway';
import { Button } from '@/shared/ui/Button';
import { Modal } from '@/shared/ui/Modal';
import { ErrorNotice } from '@/shared/ui/ErrorNotice';

interface Props {
  actor: User;
  /** 수정 대상. 없으면 새 계정 등록. */
  account: MailAccount | null;
  onClose: () => void;
  onDone: (message: string) => void;
}

const message = (error: unknown) => mailErrorText(error);

/**
 * 계정 연결 모달.
 *
 * 앱 비밀번호 입력란을 둔다. 원래는 "비밀번호가 브라우저 상태로 들어온다"는 이유로 뺐지만
 * (§4-3 · §4-6), 앱 비밀번호 방식은 사용자가 어딘가에 직접 입력하는 것 말고는 서버가 값을
 * 알 방법이 없다 — MailHub도 자체 등록 폼에서 같은 값을 받는다. 그래서 입력은 받되 흘리지
 * 않는 쪽으로 막는다: `MailAccount`·`MailAccountDraft` 도메인에는 자리를 두지 않고,
 * 이 컴포넌트의 로컬 state로만 들고 있다가 요청 본문으로 넘긴 뒤 즉시 지운다.
 */
export default function MailAccountDialog({ actor, account, onClose, onDone }: Props) {
  const editing = account !== null;
  const [provider, setProvider] = useState<MailProvider>(account?.provider ?? 'naver');
  const [displayName, setDisplayName] = useState(account?.displayName ?? '');
  const [email, setEmail] = useState(account?.email ?? '');
  const [signature, setSignature] = useState(account?.signature ?? '');
  /** 앱 비밀번호. 저장하지 않고, 요청을 보낸 뒤 비운다. 수정 시 빈 값은 "안 바꿈"이다. */
  const [secret, setSecret] = useState('');
  const [error, setError] = useState('');
  const [tested, setTested] = useState<'none' | 'ok' | 'fail'>('none');
  const [confirmRemove, setConfirmRemove] = useState(false);

  const test = useTestMailConnection();
  const create = useCreateMailAccount();
  const update = useUpdateMailAccount();
  const remove = useDeleteMailAccount();
  const busy = test.isPending || create.isPending || update.isPending || remove.isPending;

  const preset = mailProviderPreset(provider);
  const draft = { displayName, email, provider, signature };

  /** 입력한 앱 비밀번호. 비어 있으면 자격 증명을 넘기지 않는다는 뜻이다. */
  const typedSecret = secret.trim();
  /** 새 계정은 앱 비밀번호가 있어야 인증할 수 있다. 수정은 빈 값이면 기존 것을 유지한다. */
  const needsSecret = preset.authType === 'app_password' && !editing && typedSecret === '';

  /** 연결 테스트를 눌러 볼 수 있는 상태인지. 주소와 비밀번호가 있어야 의미가 있다. */
  const canTest = preset.available && email.trim() !== '' && (typedSecret !== '' || editing);

  /**
   * 저장 가능 여부.
   *
   * **연결 테스트를 통과해야 저장할 수 있다.** 서버도 저장 직전에 다시 확인하지만, 화면에서
   * 먼저 막아야 사용자가 "저장은 됐는데 메일함이 안 열리는" 계정을 만들지 않는다.
   * 수정에서 비밀번호를 건드리지 않았다면 기존 자격 증명이 그대로라 다시 시험할 필요가 없다.
   */
  const credentialChanged = typedSecret !== '';
  const mustPassTest = !editing || credentialChanged;
  const canSave = preset.available && !needsSecret && (!mustPassTest || tested === 'ok');

  const credentialOf = (): MailCredential | null =>
    typedSecret === '' ? null : { kind: 'app_password', value: typedSecret };

  const runTest = async () => {
    setError('');
    setTested('none');
    try {
      const result = await test.mutateAsync({
        actor,
        draft,
        credential: credentialOf() ?? MOCK_CREDENTIAL,
      });
      if (isConnectionOk(result)) {
        setTested('ok');
        return;
      }
      setTested('fail');
      /**
       * 어느 쪽이 막혔는지 알려준다. 네이버·다음은 IMAP 사용과 SMTP 사용이 별도 설정이라
       * "한쪽만 꺼둔" 경우가 흔한데, 뭉뚱그리면 사용자가 어디를 고칠지 알 수 없다.
       */
      const broken = [
        !result.imap.ok && `IMAP(${result.imap.code ?? '실패'})`,
        !result.smtp.ok && `SMTP(${result.smtp.code ?? '실패'})`,
      ].filter(Boolean).join(' · ');
      setError(`${broken} 연결에 실패했습니다. 메일 서비스에서 IMAP/SMTP 사용 여부와 앱 비밀번호를 확인하세요.`);
    } catch (caught) {
      setTested('fail');
      setError(message(caught));
    }
  };

  const save = async () => {
    setError('');
    try {
      if (editing) {
        await update.mutateAsync({ actor, id: account.id, draft, credential: credentialOf() });
        setSecret('');
        onDone('계정을 수정했습니다.');
      } else {
        await create.mutateAsync({ actor, draft, credential: credentialOf() ?? MOCK_CREDENTIAL });
        setSecret('');
        onDone('계정을 연결했습니다.');
      }
    } catch (caught) {
      setError(message(caught));
    }
  };

  const drop = async () => {
    setError('');
    try {
      await remove.mutateAsync({ actor, id: account?.id ?? '' });
      onDone('계정 연결을 해제했습니다.');
    } catch (caught) {
      setError(message(caught));
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={editing ? '계정 수정' : '메일 계정 연결'}
      width={520}
      footer={
        <div className="flex w-full items-center justify-between gap-2">
          {editing ? (
            confirmRemove ? (
              <span className="flex items-center gap-1">
                <Button variant="dangerSolid" disabled={busy} onClick={drop}>해제 확인</Button>
                <Button onClick={() => setConfirmRemove(false)}>취소</Button>
              </span>
            ) : (
              <Button variant="danger" onClick={() => setConfirmRemove(true)}>연결 해제</Button>
            )
          ) : <span />}

          <div className="flex items-center gap-1.5">
            <Button onClick={onClose}>취소</Button>
            <Button
              variant="primary"
              disabled={busy || !canSave}
              title={
                needsSecret
                  ? '앱 비밀번호를 입력하세요.'
                  : !canSave
                    ? '먼저 연결 테스트를 통과해야 저장할 수 있습니다.'
                    : ''
              }
              onClick={save}
            >
              저장
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-3">
        {error && <ErrorNotice message={error} />}

          <label className="block">
            <span className="mb-1 block text-[10px] font-bold text-ink3">공급자</span>
            {/*
              아직 못 여는 공급자는 비활성 옵션으로 함께 보여준다. 목록에서 아예 빼면
              "지원 예정인지 영영 없는 건지"를 사용자가 알 수 없다.
            */}
            <select
              value={provider}
              disabled={editing}
              onChange={(event) => { setProvider(event.target.value as MailProvider); setTested('none'); }}
              className="w-full rounded-lg border border-border bg-panel px-3 py-2 text-[11.5px] text-ink outline-none disabled:opacity-60"
            >
              {MAIL_PROVIDER_PRESETS.map((row) => (
                <option key={row.provider} value={row.provider} disabled={!row.available}>
                  {row.label}{row.available ? '' : ' — 준비 중'}
                </option>
              ))}
            </select>
            {/* 공급자를 바꾸면 서버 주소·인증 방식이 달라져 사실상 다른 계정이다. 수정에서는 잠근다. */}
            {editing && <span className="mt-1 block text-[9.5px] text-ink3">공급자는 등록 후 바꿀 수 없습니다. 다른 공급자는 새 계정으로 연결하세요.</span>}
            {!preset.available && preset.unavailableReason && (
              <span className="mt-1 block text-[9.5px] text-amber">{preset.unavailableReason}</span>
            )}
          </label>

          <div className="rounded-lg border border-teal/20 bg-teal-soft/20 px-3 py-2.5 text-[10px] leading-relaxed text-ink2">
            {preset.guide}
            {preset.helpUrl && (
              <>
                {' '}
                <a href={preset.helpUrl} target="_blank" rel="noreferrer" className="font-bold text-teal underline">공식 안내</a>
              </>
            )}
          </div>

          <label className="block">
            <span className="mb-1 block text-[10px] font-bold text-ink3">표시 이름</span>
            <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="업무용 네이버" className="w-full rounded-lg border border-border bg-panel px-3 py-2 text-[11.5px] text-ink outline-none" />
          </label>

          <label className="block">
            <span className="mb-1 block text-[10px] font-bold text-ink3">메일 주소</span>
            <input value={email} onChange={(event) => { setEmail(event.target.value); setTested('none'); }} placeholder="you@naver.com" className="w-full rounded-lg border border-border bg-panel px-3 py-2 text-[11.5px] text-ink outline-none" />
          </label>

          <label className="block">
            <span className="mb-1 block text-[10px] font-bold text-ink3">
              앱 비밀번호{editing && <span className="ml-1 font-semibold text-ink3">(바꿀 때만 입력)</span>}
            </span>
            <input
              value={secret}
              onChange={(event) => { setSecret(event.target.value); setTested('none'); }}
              type="password"
              autoComplete="new-password"
              placeholder={editing ? '입력하지 않으면 기존 비밀번호를 유지합니다' : '메일 서비스에서 발급받은 앱 비밀번호'}
              className="w-full rounded-lg border border-border bg-panel px-3 py-2 text-[11.5px] text-ink outline-none"
            />
            <span className="mt-1 block text-[9.5px] text-ink3">
              계정 로그인 비밀번호가 아니라 위 안내에서 발급받은 앱 비밀번호입니다. 서버에만 저장되고 화면에 다시 표시되지 않습니다.
            </span>
          </label>

          <label className="block">
            <span className="mb-1 block text-[10px] font-bold text-ink3">서명 (선택)</span>
            <textarea value={signature} onChange={(event) => setSignature(event.target.value)} rows={3} placeholder="이름 | 부서 직급&#10;회사명" className="w-full resize-y rounded-lg border border-border bg-panel px-3 py-2 text-[11.5px] text-ink outline-none" />
            <span className="mt-1 block text-[9.5px] text-ink3">새 메일을 쓸 때 본문 아래에 자동으로 붙습니다.</span>
          </label>

          <div className="flex items-center gap-2">
            <Button variant={tested === 'ok' ? undefined : 'primary'} disabled={busy || !canTest} onClick={runTest}>
              {test.isPending ? '확인 중…' : tested === 'ok' ? '다시 확인' : '① 연결 테스트'}
            </Button>
            {tested === 'ok' && <span className="text-[10.5px] font-bold text-teal">SMTP·IMAP 연결을 확인했습니다. 이제 저장할 수 있습니다.</span>}
            {tested === 'fail' && <span className="text-[10.5px] font-bold text-amber">연결하지 못했습니다. 위 오류를 확인하세요.</span>}
            {tested === 'none' && mustPassTest && (
              <span className="text-[10.5px] text-ink3">연결을 확인해야 저장할 수 있습니다.</span>
            )}
        </div>
      </div>
    </Modal>
  );
}
