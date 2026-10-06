import { useRef, useState } from 'react';
import { useAuth } from '@/app/auth/AuthProvider';
import { useNavigate } from 'react-router-dom';
import { useUploadSeal } from '@/features/user/useUploadSeal';
import { useUploadAvatar } from '@/features/user/useUploadAvatar';
import { useQueryClient } from '@tanstack/react-query';
import SignaturePad from './components/SignaturePad';

/**
 * 개인 프로필 설정 화면 — /profile 라우트.
 * 모든 사용자가 자신의 이메일, 비밀번호, 인감(도장) 및 서명 이미지를 관리할 수 있다.
 */
export default function ProfileScreen() {
  const { user, changePassword, updateProfile } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { upload, uploading } = useUploadSeal();
  const sealInputRef = useRef<HTMLInputElement>(null);

  /* ── 기본 정보 편집 상태 ── */
  const [email, setEmail] = useState(user?.email ?? '');
  const [infoMsg, setInfoMsg] = useState('');
  const [infoErr, setInfoErr] = useState('');
  const [savingInfo, setSavingInfo] = useState(false);

  /* ── 비밀번호 변경 상태 ── */
  const [curPw, setCurPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [pwMsg, setPwMsg] = useState('');
  const [pwErr, setPwErr] = useState('');
  const [savingPw, setSavingPw] = useState(false);

  /* ── 인감 및 서명 이미지 상태 ── */
  const [sealPreview, setSealPreview] = useState<string>(user?.sealUrl ?? '');
  const [signPreview, setSignPreview] = useState<string>(user?.signUrl ?? '');
  const [sealMsg, setSealMsg] = useState('');
  const [sealErr, setSealErr] = useState('');
  const [savingSeal, setSavingSeal] = useState(false);
  const [savingSign, setSavingSign] = useState(false);

  /* ── 프로필 사진 상태 ── */
  const { upload: uploadAvatar, uploading: uploadingAvatar } = useUploadAvatar();
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const [avatarPreview, setAvatarPreview] = useState<string>(user?.photoUrl ?? '');
  const [avatarMsg, setAvatarMsg] = useState('');
  const [avatarErr, setAvatarErr] = useState('');

  if (!user) return null;

  const initials = user.name ? user.name.slice(-2) : 'WF';

  /* ── 핸들러: 기본 정보 저장 ── */
  const handleSaveInfo = async () => {
    if (!email.trim()) { setInfoErr('이메일을 입력하세요.'); return; }
    setSavingInfo(true); setInfoErr(''); setInfoMsg('');
    try {
      await updateProfile({ email: email.trim() });
      await queryClient.invalidateQueries({ queryKey: ['users'] });
      setInfoMsg('기본 정보가 수정되었습니다.');
    } catch (e) {
      setInfoErr(e instanceof Error ? e.message : '저장에 실패했습니다.');
    } finally {
      setSavingInfo(false);
    }
  };

  /* ── 핸들러: 비밀번호 변경 ── */
  const handleChangePw = async () => {
    setPwErr(''); setPwMsg('');
    if (!curPw) { setPwErr('현재 비밀번호를 입력하세요.'); return; }
    
    // 영문자, 숫자, 특수기호 포함 9자 이상 검증
    const pwRegex = /^(?=.*[a-zA-Z])(?=.*\d)(?=.*[^a-zA-Z0-9]).{9,}$/;
    if (!pwRegex.test(newPw)) {
      setPwErr('비밀번호는 영문자, 숫자, 특수기호가 포함된 9자 이상이어야 합니다.');
      return;
    }
    
    if (newPw !== confirmPw) { setPwErr('새 비밀번호가 일치하지 않습니다.'); return; }
    setSavingPw(true);
    try {
      await changePassword(curPw, newPw);
      setCurPw(''); setNewPw(''); setConfirmPw('');
      setPwMsg('비밀번호가 변경되었습니다.');
    } catch (e) {
      setPwErr(e instanceof Error ? e.message : '변경에 실패했습니다.');
    } finally {
      setSavingPw(false);
    }
  };

  /* ── 핸들러: 인감 이미지 선택 ── */
  const handleSealFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { setSealErr('파일이 너무 큽니다. 5MB 이내로 선택하세요.'); return; }
    setSavingSeal(true);
    setSealErr(''); setSealMsg('');
    try {
      const url = await upload(user.id, file);
      await updateProfile({ sealUrl: url });
      setSealPreview(url);
      await queryClient.invalidateQueries({ queryKey: ['users'] });
      setSealMsg('인감 이미지가 저장되었습니다.');
    } catch (e) {
      setSealErr(e instanceof Error ? e.message : '업로드에 실패했습니다.');
    } finally {
      setSavingSeal(false);
    }
  };

  /* ── 핸들러: 인감 이미지 삭제 ── */
  const handleDeleteSeal = async () => {
    if (!window.confirm('인감 이미지를 삭제하시겠습니까?')) return;
    setSealErr(''); setSealMsg('');
    try {
      await updateProfile({ sealUrl: '' });
      setSealPreview('');
      await queryClient.invalidateQueries({ queryKey: ['users'] });
      setSealMsg('인감 이미지가 삭제되었습니다.');
    } catch (e) {
      setSealErr(e instanceof Error ? e.message : '삭제에 실패했습니다.');
    }
  };

  /* ── 핸들러: 서명 이미지 저장 ── */
  const handleSaveSignature = async (file: File) => {
    setSavingSign(true); setSealErr(''); setSealMsg('');
    try {
      const url = await upload(user.id, file);
      await updateProfile({ signUrl: url });
      setSignPreview(url);
      await queryClient.invalidateQueries({ queryKey: ['users'] });
      setSealMsg('서명이 저장되었습니다.');
    } catch (e) {
      setSealErr(e instanceof Error ? e.message : '서명 저장에 실패했습니다.');
    } finally {
      setSavingSign(false);
    }
  };

  /* ── 핸들러: 서명 이미지 삭제 ── */
  const handleDeleteSignature = async () => {
    if (!window.confirm('등록된 서명을 삭제하시겠습니까?')) return;
    setSealErr(''); setSealMsg('');
    try {
      await updateProfile({ signUrl: '' });
      setSignPreview('');
      await queryClient.invalidateQueries({ queryKey: ['users'] });
      setSealMsg('서명이 삭제되었습니다.');
    } catch (e) {
      setSealErr(e instanceof Error ? e.message : '서명 삭제에 실패했습니다.');
    }
  };

  /* ── 핸들러: 결재 인증 타입 토글 ── */
  const handleToggleSignType = async (type: 'stamp' | 'signature') => {
    setSealErr(''); setSealMsg('');
    try {
      await updateProfile({ signType: type });
      await queryClient.invalidateQueries({ queryKey: ['users'] });
    } catch (e) {
      setSealErr(e instanceof Error ? e.message : '설정 변경에 실패했습니다.');
    }
  };

  /* ── 핸들러: 프로필 사진 파일 선택 ── */
  const handleAvatarFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { setAvatarErr('파일이 너무 큽니다. 5MB 이내로 선택하세요.'); return; }
    setAvatarErr(''); setAvatarMsg('');
    try {
      const url = await uploadAvatar(user.id, file);
      setAvatarPreview(url);
      await updateProfile({ photoUrl: url });
      await queryClient.invalidateQueries({ queryKey: ['users'] });
      setAvatarMsg('프로필 사진이 저장되었습니다.');
    } catch (e) {
      setAvatarErr(e instanceof Error ? e.message : '업로드에 실패했습니다.');
    }
  };

  /* ── 핸들러: 프로필 사진 삭제 ── */
  const handleDeleteAvatar = async () => {
    if (!window.confirm('프로필 사진을 삭제하시겠습니까?')) return;
    setAvatarErr(''); setAvatarMsg('');
    try {
      await updateProfile({ photoUrl: '' });
      setAvatarPreview('');
      await queryClient.invalidateQueries({ queryKey: ['users'] });
      setAvatarMsg('프로필 사진이 삭제되었습니다.');
    } catch (e) {
      setAvatarErr(e instanceof Error ? e.message : '삭제에 실패했습니다.');
    }
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6 pb-12">
      {/* 헤더 */}
      <div className="flex items-center gap-3 pb-1">
        <button
          onClick={() => navigate(-1)}
          className="grid h-7 w-7 place-items-center rounded-lg text-[16px] text-ink2 hover:bg-panel-alt"
        >
          ←
        </button>
        <h1 className="text-[17px] font-extrabold text-ink">프로필 설정</h1>
      </div>

      {/* ① 기본 정보 */}
      <section className="rounded-2xl border border-border bg-panel p-6 shadow-sm">
        <div className="mb-5 flex items-center gap-2">
          <span className="h-4 w-1 rounded-sm bg-teal" />
          <h2 className="text-[13px] font-extrabold text-ink">기본 정보</h2>
        </div>

        {/* 프로필 사진 설정 */}
        <div className="mb-6 flex items-center gap-6 pb-6 border-b border-border">
          <div className="relative h-20 w-20 shrink-0">
            <div className="h-full w-full overflow-hidden rounded-full border border-border bg-panel-alt flex items-center justify-center text-ink3 font-bold text-lg">
              {avatarPreview ? (
                <img src={avatarPreview} alt="프로필 사진" className="h-full w-full object-cover" />
              ) : (
                <span className="text-[20px] font-black">{initials}</span>
              )}
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <div className="text-[11px] font-bold text-ink2">프로필 사진</div>
            <div className="flex gap-2">
              <input
                ref={avatarInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={handleAvatarFile}
              />
              <button
                onClick={() => avatarInputRef.current?.click()}
                disabled={uploadingAvatar}
                className="rounded-lg border border-border-hi bg-panel-alt px-3.5 py-1.5 text-[11.5px] font-semibold text-ink hover:bg-border/30 disabled:opacity-50"
              >
                {uploadingAvatar ? '업로드 중…' : avatarPreview ? '사진 변경' : '사진 등록'}
              </button>
              {avatarPreview && (
                <button
                  onClick={handleDeleteAvatar}
                  className="rounded-lg border border-danger/30 px-3.5 py-1.5 text-[11.5px] font-semibold text-danger hover:bg-danger/5"
                >
                  사진 삭제
                </button>
              )}
            </div>
            {avatarMsg && <p className="text-[11px] font-semibold text-teal">{avatarMsg}</p>}
            {avatarErr && <p className="text-[11px] font-semibold text-danger">{avatarErr}</p>}
          </div>
        </div>

        {/* 읽기 전용 필드 */}
        <div className="grid grid-cols-2 gap-x-6 gap-y-3 mb-5">
          {[
            ['이름', user.name],
            ['사번', user.empNo],
            ['부서', user.dept],
            ['직급', user.position],
            ['직책', user.jobTitle || '—'],
          ].map(([label, value]) => (
            <div key={label}>
              <div className="mb-0.5 text-[10.5px] font-bold text-ink3">{label}</div>
              <div className="rounded-lg border border-border bg-panel-alt px-3 py-2 text-[12.5px] text-ink2">{value}</div>
            </div>
          ))}
        </div>

        {/* 편집 가능: 이메일 */}
        <div className="mb-4">
          <label className="mb-0.5 block text-[10.5px] font-bold text-ink3">이메일</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-lg border border-border-hi bg-transparent px-3 py-2 text-[12.5px] text-ink outline-none focus:border-teal focus:ring-1 focus:ring-teal/30"
          />
        </div>

        {infoMsg && <p className="mb-2 text-[11.5px] font-semibold text-teal">{infoMsg}</p>}
        {infoErr && <p className="mb-2 text-[11.5px] font-semibold text-danger">{infoErr}</p>}

        <button
          onClick={handleSaveInfo}
          disabled={savingInfo}
          className="rounded-lg bg-navy px-5 py-2 text-[12.5px] font-bold text-white hover:opacity-90 disabled:opacity-50"
        >
          {savingInfo ? '저장 중…' : '정보 저장'}
        </button>
      </section>

      {/* ② 비밀번호 변경 */}
      <section className="rounded-2xl border border-border bg-panel p-6 shadow-sm">
        <div className="mb-5 flex items-center gap-2">
          <span className="h-4 w-1 rounded-sm bg-teal" />
          <h2 className="text-[13px] font-extrabold text-ink">비밀번호 변경</h2>
        </div>

        <div className="space-y-3 mb-4">
          {[
            { label: '현재 비밀번호', value: curPw, setter: setCurPw },
            { label: '새 비밀번호', value: newPw, setter: setNewPw },
            { label: '새 비밀번호 확인', value: confirmPw, setter: setConfirmPw },
          ].map(({ label, value, setter }) => (
            <div key={label}>
              <label className="mb-0.5 block text-[10.5px] font-bold text-ink3">{label}</label>
              <input
                type="password"
                value={value}
                onChange={(e) => setter(e.target.value)}
                placeholder="••••••••"
                className="w-full rounded-lg border border-border-hi bg-transparent px-3 py-2 text-[12.5px] text-ink outline-none focus:border-teal focus:ring-1 focus:ring-teal/30"
              />
            </div>
          ))}
        </div>

        {pwMsg && <p className="mb-2 text-[11.5px] font-semibold text-teal">{pwMsg}</p>}
        {pwErr && <p className="mb-2 text-[11.5px] font-semibold text-danger">{pwErr}</p>}

        <button
          onClick={handleChangePw}
          disabled={savingPw}
          className="rounded-lg bg-navy px-5 py-2 text-[12.5px] font-bold text-white hover:opacity-90 disabled:opacity-50"
        >
          {savingPw ? '변경 중…' : '비밀번호 변경'}
        </button>
      </section>

      {/* ③ 결재 인감 / 서명 설정 */}
      <section className="rounded-2xl border border-border bg-panel p-6 shadow-sm">
        <div className="mb-2 flex items-center gap-2">
          <span className="h-4 w-1 rounded-sm bg-teal" />
          <h2 className="text-[13px] font-extrabold text-ink">결재 인증 설정</h2>
        </div>
        <p className="mb-5 text-[11px] text-ink3">
          전자결재 상신 시 문서 서명란에 표시될 인증 수단을 선택하고 등록합니다.
        </p>

        {/* 라디오 탭 스위치 */}
        <div className="mb-6 flex gap-6 border-b border-border pb-3">
          <label className="flex items-center gap-2 text-[12px] font-bold text-ink cursor-pointer">
            <input
              type="radio"
              name="signType"
              checked={user.signType === 'stamp' || !user.signType}
              onChange={() => handleToggleSignType('stamp')}
              className="accent-teal"
            />
            인감(도장) 이미지
          </label>
          <label className="flex items-center gap-2 text-[12px] font-bold text-ink cursor-pointer">
            <input
              type="radio"
              name="signType"
              checked={user.signType === 'signature'}
              onChange={() => handleToggleSignType('signature')}
              className="accent-teal"
            />
            수필 서명
          </label>
        </div>

        {/* 조건부 렌더링 */}
        {(user.signType === 'stamp' || !user.signType) ? (
          <div className="flex items-start gap-6">
            {/* 인감 미리보기 */}
            <div
              className="flex h-[100px] w-[100px] shrink-0 items-center justify-center rounded-xl border-2 border-dashed border-border-hi bg-panel-alt text-center overflow-hidden"
            >
              {sealPreview ? (
                <img src={sealPreview} alt="인감" className="h-full w-full object-contain" />
              ) : (
                <div className="space-y-1">
                  <div className="grid h-[56px] w-[56px] mx-auto place-items-center rounded-full border-2 border-[#c0392b] text-[12px] font-bold text-[#c0392b]">
                    {user.name.slice(-2)}
                  </div>
                  <div className="text-[9px] text-ink3">미등록</div>
                </div>
              )}
            </div>

            <div className="flex flex-col gap-2 pt-1">
              <input
                ref={sealInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={handleSealFile}
              />
              <button
                onClick={() => sealInputRef.current?.click()}
                disabled={uploading || savingSeal || savingSign}
                className="rounded-lg border border-border-hi bg-panel-alt px-4 py-2 text-[12px] font-semibold text-ink hover:bg-border/30 disabled:opacity-50"
              >
                {uploading || savingSeal ? '저장 중…' : sealPreview ? '이미지 변경' : '이미지 등록'}
              </button>
              {sealPreview && (
                <button
                  onClick={handleDeleteSeal}
                  disabled={uploading || savingSeal || savingSign}
                  className="rounded-lg border border-danger/30 px-4 py-2 text-[12px] font-semibold text-danger hover:bg-danger/5 disabled:opacity-50"
                >
                  이미지 삭제
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {signPreview ? (
              <div className="flex items-start gap-6">
                {/* 서명 미리보기 */}
                <div
                  className="flex h-[100px] w-[200px] shrink-0 items-center justify-center rounded-xl border border-border-hi bg-panel-alt text-center overflow-hidden"
                >
                  <img src={signPreview} alt="등록된 서명" className="h-full w-full object-contain" />
                </div>
                <div className="pt-2">
                  <button
                    onClick={handleDeleteSignature}
                    className="rounded-lg border border-danger/30 px-4 py-2 text-[12px] font-semibold text-danger hover:bg-danger/5"
                  >
                    서명 삭제
                  </button>
                </div>
              </div>
            ) : (
              <div>
                <div className="mb-2 text-[11px] text-ink3">아래 빈 영역에 서명을 그려 등록하세요.</div>
                <SignaturePad onSave={handleSaveSignature} saving={savingSign} />
              </div>
            )}
          </div>
        )}

        {sealMsg && <p className="mt-4 text-[11.5px] font-semibold text-teal">{sealMsg}</p>}
        {sealErr && <p className="mt-4 text-[11.5px] font-semibold text-danger">{sealErr}</p>}
      </section>
    </div>
  );
}
