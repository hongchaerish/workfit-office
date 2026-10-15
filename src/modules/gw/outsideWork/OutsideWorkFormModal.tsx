import { useMemo, useState } from 'react';
import type { User } from '@/domain/user/schema';
import {
  OUTSIDE_WORK_CATEGORY_LABELS,
  OUTSIDE_WORK_SUBTYPES,
  outsideWorkSchema,
  type OutsideWork,
  type OutsideWorkCategory,
  type OutsideWorkDraft,
} from '@/domain/outsideWork/schema';
import type { OutsideScheduleView } from '@/domain/outsideWork/view';
import type { OutsideWorkActor } from '@/data/outsideWork/outsideWork.repo';
import { useCreateOutsideWork, useUpdateOutsideWork } from '@/features/outsideWork/useOutsideWorks';
import { useCommutePolicy } from '@/features/commute/useCommutePolicy';
import { DEFAULT_COMMUTE_POLICY } from '@/domain/commutePolicy/schema';
import { MemberPicker } from '@/modules/gw/task/MemberPicker';
import { Modal } from '@/shared/ui/Modal';
import { Button } from '@/shared/ui/Button';
import { Field } from '@/shared/ui/form/Field';
import { TextField } from '@/shared/ui/form/TextField';

interface OutsideWorkFormModalProps {
  actor: OutsideWorkActor;
  initialDate: string;
  /** 수정이면 원본 */
  work?: OutsideWork;
  users: User[];
  /** 같은 사람의 이미 잡힌 외근·출장 — 기간이 겹치면 경고만 한다(등록은 막지 않음) */
  existing?: OutsideScheduleView[];
  onClose: () => void;
  onSaved?: (saved: OutsideWork) => void;
}

const MIDDAY = '13:00';

const textareaClass =
  'min-h-[60px] rounded-md border border-border-hi bg-panel px-3 py-2 text-[13px] text-ink outline-none transition-colors placeholder:text-ink3 focus:border-teal';

/**
 * 외근·출장 직접 등록·수정 — 결재 없이 본인이 올린다.
 * 저장하면 업무계획·캘린더에 보이고 근태·재실 상태에도 외근·출장으로 반영된다.
 */
export function OutsideWorkFormModal({ actor, initialDate, work, users, existing = [], onClose, onSaved }: OutsideWorkFormModalProps) {
  const { policy = DEFAULT_COMMUTE_POLICY } = useCommutePolicy();
  const create = useCreateOutsideWork();
  const update = useUpdateOutsideWork();

  const [category, setCategory] = useState<OutsideWorkCategory>(work?.category ?? 'OUTSIDE');
  const [subType, setSubType] = useState(work?.subType ?? OUTSIDE_WORK_SUBTYPES.OUTSIDE[0]);
  const [startDate, setStartDate] = useState(work?.startDate ?? initialDate);
  const [endDate, setEndDate] = useState(work?.endDate ?? initialDate);
  const [allDay, setAllDay] = useState(work?.allDay ?? true);
  const [startTime, setStartTime] = useState(work?.startTime ?? policy.workStartTime);
  const [endTime, setEndTime] = useState(work?.endTime ?? policy.workEndTime);
  const [destination, setDestination] = useState(work?.destination ?? '');
  const [purpose, setPurpose] = useState(work?.purpose ?? '');
  const [companions, setCompanions] = useState<string[]>(work?.companionUserIds ?? []);
  const [showCompanions, setShowCompanions] = useState((work?.companionUserIds.length ?? 0) > 0);
  const [transportation, setTransportation] = useState(work?.transportation ?? '');
  const [contact, setContact] = useState(work?.contact ?? '');
  const [memo, setMemo] = useState(work?.memo ?? '');
  const [error, setError] = useState('');

  const saving = create.isPending || update.isPending;
  const pickable = useMemo(() => users.filter((u) => u.id !== actor.userId), [users, actor.userId]);
  const nameOf = (id: string) => users.find((u) => u.id === id)?.name ?? id;

  /** 세부 구분을 고르면 시간을 맞춰 준다 — 종일·출장은 시간 없음, 오전/오후는 근무시간 반으로 */
  const pickSubType = (next: string) => {
    setSubType(next);
    if (next === '오전 외근') {
      setAllDay(false); setStartTime(policy.workStartTime); setEndTime(MIDDAY);
    } else if (next === '오후 외근') {
      setAllDay(false); setStartTime(MIDDAY); setEndTime(policy.workEndTime);
    } else if (next === '시간 외근') {
      setAllDay(false);
    } else {
      setAllDay(true);
    }
  };

  const pickCategory = (next: OutsideWorkCategory) => {
    setCategory(next);
    pickSubType(OUTSIDE_WORK_SUBTYPES[next][0]);
  };

  const overlapping = existing.filter(
    (v) => v.key !== (work ? `self-${work.id}` : '') && v.startDate <= endDate && v.endDate >= startDate,
  );

  const submit = async () => {
    setError('');
    const draft: OutsideWorkDraft = {
      category,
      subType,
      startDate,
      endDate: endDate < startDate ? startDate : endDate,
      allDay,
      startTime: allDay ? null : startTime,
      endTime: allDay ? null : endTime,
      destination,
      purpose,
      companionUserIds: companions.filter((id) => id !== actor.userId),
      transportation,
      contact,
      memo,
    };
    // 저장 전에 같은 규칙으로 먼저 걸러 첫 오류를 바로 보여 준다
    const now = new Date().toISOString();
    const check = outsideWorkSchema.safeParse({ ...draft, id: 'OW-00000000-0000', ownerUserId: actor.userId, createdAt: now, updatedAt: now });
    if (!check.success) {
      setError(check.error.issues[0]?.message ?? '입력값을 확인하세요.');
      return;
    }
    try {
      const saved = work
        ? await update.mutateAsync({ actor, id: work.id, draft })
        : await create.mutateAsync({ actor, draft });
      onSaved?.(saved);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : '저장하지 못했습니다.');
    }
  };

  const segBtn = (active: boolean) =>
    `rounded-md border px-3 py-1.5 text-[11px] font-bold transition-colors ${
      active ? 'border-teal bg-teal text-white' : 'border-border text-ink2 hover:bg-panel-alt'
    }`;

  return (
    <Modal
      open
      onClose={onClose}
      width={520}
      title={work ? '외근·출장 수정' : '외근·출장 등록'}
      footer={(
        <>
          <Button onClick={onClose} disabled={saving}>취소</Button>
          <Button variant="primary" onClick={() => void submit()} disabled={saving}>
            {saving ? '저장 중…' : work ? '저장' : '등록'}
          </Button>
        </>
      )}
    >
      <div className="flex flex-col gap-3.5">
        <Field label="구분" required>
          <div className="flex flex-wrap gap-1.5">
            {(Object.keys(OUTSIDE_WORK_CATEGORY_LABELS) as OutsideWorkCategory[]).map((c) => (
              <button key={c} type="button" className={segBtn(category === c)} onClick={() => pickCategory(c)}>
                {OUTSIDE_WORK_CATEGORY_LABELS[c]}
              </button>
            ))}
            <span className="mx-1 w-px self-stretch bg-border" />
            {OUTSIDE_WORK_SUBTYPES[category].map((s) => (
              <button key={s} type="button" className={segBtn(subType === s)} onClick={() => pickSubType(s)}>
                {s}
              </button>
            ))}
          </div>
        </Field>

        <div className="grid grid-cols-2 gap-2.5">
          <Field label="시작일" required>
            <TextField
              type="date"
              value={startDate}
              onChange={(e) => {
                setStartDate(e.target.value);
                if (category === 'OUTSIDE' || endDate < e.target.value) setEndDate(e.target.value);
              }}
            />
          </Field>
          <Field label="종료일" required>
            <TextField type="date" value={endDate} min={startDate} onChange={(e) => setEndDate(e.target.value)} />
          </Field>
        </div>

        <Field label="시간">
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1.5 text-[11.5px] font-semibold text-ink2">
              <input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} />
              종일
            </label>
            {!allDay && (
              <>
                <TextField type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} className="w-[120px]" />
                <span className="text-ink3">~</span>
                <TextField type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} className="w-[120px]" />
              </>
            )}
          </div>
        </Field>

        <Field label="장소" required>
          <TextField value={destination} maxLength={200} placeholder="예: OO전자 수원사업장" onChange={(e) => setDestination(e.target.value)} />
        </Field>

        <Field label="목적">
          <textarea className={textareaClass} value={purpose} maxLength={500} placeholder="예: 신규 설비 견적 협의" onChange={(e) => setPurpose(e.target.value)} />
        </Field>

        <Field label="동행자">
          {companions.length > 0 && (
            <div className="mb-1 text-[11.5px] font-semibold text-ink">{companions.map(nameOf).join(', ')}</div>
          )}
          {showCompanions ? (
            <MemberPicker users={pickable} selected={companions} lockedUserId="" onChange={setCompanions} />
          ) : (
            <div>
              <Button size="sm" variant="accent" onClick={() => setShowCompanions(true)}>동행자 선택</Button>
            </div>
          )}
        </Field>

        <div className="grid grid-cols-2 gap-2.5">
          <Field label="교통수단">
            <TextField value={transportation} maxLength={50} placeholder="예: 법인차량" onChange={(e) => setTransportation(e.target.value)} />
          </Field>
          <Field label="연락처">
            <TextField value={contact} maxLength={50} placeholder="현지 연락처" onChange={(e) => setContact(e.target.value)} />
          </Field>
        </div>

        <Field label="메모">
          <textarea className={textareaClass} value={memo} maxLength={2000} onChange={(e) => setMemo(e.target.value)} />
        </Field>

        {overlapping.length > 0 && (
          <p className="rounded-md border border-amber/30 bg-amber-soft/30 px-3 py-2 text-[11px] font-semibold text-amber">
            이 기간에 이미 외근·출장이 있습니다:{' '}
            {overlapping.map((v) => `${v.subType}${v.destination ? ` (${v.destination})` : ''}${v.source === 'APPROVAL' ? ' · 결재 완료' : ''}`).join(', ')}
          </p>
        )}

        <p className="rounded-md bg-panel-alt/60 px-3 py-2 text-[10.5px] leading-relaxed text-ink3">
          결재 없이 바로 등록됩니다. 전 직원에게 공개되며, 근태(출퇴근 판정)와 근무 상태에 외근·출장으로 반영됩니다.
        </p>

        {error && <p className="text-[11px] font-semibold text-danger">{error}</p>}
      </div>
    </Modal>
  );
}
