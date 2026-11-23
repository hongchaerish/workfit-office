import { Check, DoorOpen } from 'lucide-react';
import type { Resource } from '@/domain/resource/schema';
import { TextField } from '@/shared/ui/form/TextField';

interface RoomPickerProps {
  mode: 'text' | 'room';
  onModeChange: (mode: 'text' | 'room') => void;
  text: string;
  onTextChange: (text: string) => void;
  /** 고른 시간에 비어 있는지까지 붙은 회의실 목록 */
  rooms: Array<{ resource: Resource; available: boolean }>;
  roomId: string | null;
  onRoomChange: (roomId: string | null) => void;
  disabled?: boolean;
}

const tabClass = (active: boolean) =>
  `px-3 py-1 text-[11px] font-semibold transition-colors disabled:cursor-not-allowed ${
    active ? 'bg-blue-soft text-blue' : 'text-ink2 hover:bg-panel-alt'
  }`;

/**
 * 회의 장소 — 직접 적기 / 자원예약 회의실 고르기.
 * 고른 시간에 예약이 있는 방은 고를 수 없다(저장 때 한 번 더 충돌 검사).
 */
export function RoomPicker({ mode, onModeChange, text, onTextChange, rooms, roomId, onRoomChange, disabled }: RoomPickerProps) {
  return (
    <div className="flex flex-col gap-2">
      <div className="inline-flex self-start overflow-hidden rounded-md border border-border bg-panel">
        <button type="button" className={tabClass(mode === 'text')} disabled={disabled} onClick={() => onModeChange('text')}>
          직접 적기
        </button>
        <button
          type="button"
          className={`border-l border-border ${tabClass(mode === 'room')}`}
          disabled={disabled}
          onClick={() => onModeChange('room')}
        >
          회의실
        </button>
      </div>

      {mode === 'text' ? (
        <TextField
          aria-label="회의 장소"
          value={text}
          maxLength={100}
          placeholder="장소"
          disabled={disabled}
          onChange={(e) => onTextChange(e.target.value)}
        />
      ) : rooms.length === 0 ? (
        <div className="rounded-md border border-border px-3 py-3 text-center text-[11px] text-ink3">
          고를 수 있는 회의실이 없습니다.
        </div>
      ) : (
        <ul role="listbox" aria-label="회의실" className="max-h-44 overflow-y-auto rounded-md border border-border p-1">
          {rooms.map(({ resource, available }) => {
            const selected = resource.id === roomId;
            const blocked = !available && !selected;
            return (
              <li key={resource.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={selected}
                  disabled={disabled || blocked}
                  onClick={() => onRoomChange(selected ? null : resource.id)}
                  className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[11.5px] transition-colors disabled:cursor-not-allowed ${
                    selected ? 'bg-blue-soft text-blue' : blocked ? 'text-ink3 opacity-60' : 'text-ink hover:bg-panel-alt'
                  }`}
                >
                  <DoorOpen size={13} className="shrink-0 text-ink3" />
                  <span className="min-w-0 flex-1 truncate font-semibold">{resource.name}</span>
                  {resource.capacity != null && (
                    <span className="shrink-0 text-[10.5px] text-ink3">{resource.capacity}명</span>
                  )}
                  {resource.approvalMode === 'APPROVAL' && (
                    <span className="shrink-0 rounded bg-amber-soft px-1.5 py-0.5 text-[9.5px] font-bold text-amber">승인 필요</span>
                  )}
                  {blocked && <span className="shrink-0 text-[10.5px] font-semibold text-danger">예약 있음</span>}
                  {selected && <Check size={13} className="shrink-0" />}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
