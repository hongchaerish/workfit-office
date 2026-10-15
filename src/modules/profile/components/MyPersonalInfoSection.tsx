import { useState } from 'react';
import type { User } from '@/domain/user/schema';
import type { EmployeeProfile } from '@/domain/employeeProfile/schema';
import { useEmployeeProfiles, useUpdateMyEmployeeProfile } from '@/features/employeeProfile/useEmployeeProfiles';
import { calendarToday } from '@/domain/calendarEvent/calendarDate';
import { describeBirthday } from '@/domain/birthday/engine';

const inputClass =
  'w-full rounded-lg border border-border-hi bg-transparent px-3 py-2 text-[12.5px] text-ink outline-none focus:border-teal focus:ring-1 focus:ring-teal/30';

/**
 * 프로필 설정 > 인사 정보(본인 입력).
 * 연락처·개인 이메일·비상연락처·주소·생년월일(음력 여부)·생일 공개를 본인이 등록·수정·삭제한다.
 * 칸을 비우고 저장하면 그 항목이 지워진다. 소속·직급·주민번호 등은 인사 관리자만 바꾼다.
 */
export default function MyPersonalInfoSection({ user }: { user: User }) {
  const { data: profiles, isLoading } = useEmployeeProfiles();
  if (isLoading || !profiles) {
    return <p className="text-[11.5px] text-ink3">불러오는 중…</p>;
  }
  const mine = profiles.find((p) => p.userId === user.id || p.id === user.id) ?? null;
  // 저장 후 다시 읽힌 값으로 폼을 새로 채운다
  return <MyPersonalInfoForm key={mine?.updatedAt ?? 'new'} user={user} profile={mine} />;
}

function MyPersonalInfoForm({ user, profile }: { user: User; profile: EmployeeProfile | null }) {
  const update = useUpdateMyEmployeeProfile();
  const [phone, setPhone] = useState(profile?.phone ?? '');
  const [personalEmail, setPersonalEmail] = useState(profile?.personalEmail ?? '');
  const [emergencyPhone, setEmergencyPhone] = useState(profile?.emergencyPhone ?? '');
  const [address, setAddress] = useState(profile?.address ?? '');
  const [birthDate, setBirthDate] = useState(profile?.birthDate ?? '');
  const [birthLunar, setBirthLunar] = useState(profile?.birthLunar ?? false);
  const [birthdayPublic, setBirthdayPublic] = useState(profile?.birthdayPublic ?? true);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  const birthdayText = describeBirthday({ birthDate, birthLunar }, calendarToday());

  const save = async () => {
    setMsg(''); setErr('');
    if (personalEmail.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(personalEmail.trim())) {
      setErr('개인 이메일 형식이 올바르지 않습니다.');
      return;
    }
    try {
      await update.mutateAsync({
        me: { id: user.id, empNo: user.empNo, name: user.name, dept: user.dept, position: user.position, jobTitle: user.jobTitle },
        patch: {
          phone: phone.trim(),
          personalEmail: personalEmail.trim(),
          emergencyPhone: emergencyPhone.trim(),
          address: address.trim(),
          birthDate,
          birthLunar,
          birthdayPublic,
        },
      });
      setMsg('인사 정보가 저장되었습니다.');
    } catch (e) {
      setErr(e instanceof Error ? e.message : '저장에 실패했습니다.');
    }
  };

  const field = (label: string, value: string, set: (v: string) => void, props: Record<string, string> = {}) => (
    <div>
      <label className="mb-0.5 block text-[10.5px] font-bold text-ink3">{label}</label>
      <input value={value} onChange={(e) => set(e.target.value)} className={inputClass} {...props} />
    </div>
  );

  return (
    <>
      <div className="mb-4 grid grid-cols-2 gap-x-6 gap-y-3">
        {field('연락처', phone, setPhone, { placeholder: '010-0000-0000', inputMode: 'tel' })}
        {field('비상 연락처', emergencyPhone, setEmergencyPhone, { placeholder: '010-0000-0000', inputMode: 'tel' })}
        {field('개인 이메일', personalEmail, setPersonalEmail, { type: 'email', placeholder: 'name@example.com' })}
        <div />
        <div className="col-span-2">{field('주소', address, setAddress)}</div>

        <div className="col-span-2">
          <label className="mb-0.5 block text-[10.5px] font-bold text-ink3">생년월일</label>
          <div className="flex flex-wrap items-center gap-3">
            <input type="date" value={birthDate} onChange={(e) => setBirthDate(e.target.value)} className={`${inputClass} !w-[170px]`} />
            <label className="flex cursor-pointer items-center gap-1.5 text-[12px] font-bold text-ink">
              <input type="checkbox" checked={birthLunar} onChange={(e) => setBirthLunar(e.target.checked)} className="h-4 w-4 accent-teal" />
              음력
            </label>
            <label className="flex cursor-pointer items-center gap-1.5 text-[12px] font-bold text-ink">
              <input type="checkbox" checked={birthdayPublic} onChange={(e) => setBirthdayPublic(e.target.checked)} className="h-4 w-4 accent-teal" />
              생일 공개
            </label>
            {birthDate && (
              <button type="button" onClick={() => setBirthDate('')} className="text-[11px] font-semibold text-ink3 hover:text-danger">
                지우기
              </button>
            )}
          </div>
          <p className="mt-1 text-[10.5px] text-ink3">
            {birthdayText ? `생일: ${birthdayText}. ` : ''}
            음력이면 매년 양력 날짜로 바꿔 계산합니다. 공개를 끄면 생일 알림·게시에서 빠집니다.
          </p>
        </div>
      </div>

      {msg && <p className="mb-2 text-[11.5px] font-semibold text-teal">{msg}</p>}
      {err && <p className="mb-2 text-[11.5px] font-semibold text-danger">{err}</p>}

      <button
        onClick={() => void save()}
        disabled={update.isPending}
        className="rounded-lg bg-navy px-5 py-2 text-[12.5px] font-bold text-white hover:opacity-90 disabled:opacity-50"
      >
        {update.isPending ? '저장 중…' : '인사 정보 저장'}
      </button>
    </>
  );
}
