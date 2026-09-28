import { useState, useMemo } from 'react';
import { Download, RotateCcw, Plus, Pencil, Trash2, Calendar, X } from 'lucide-react';
import { Card } from '@/shared/ui/Card';
import { Button } from '@/shared/ui/Button';
import { FilterBar, FilterField, Select, TextInput, type Option } from '@/shared/ui/FilterBar';
import {
  useHolidays,
  useCreateHoliday,
  useUpdateHoliday,
  useDeleteHoliday,
  useResetHolidays,
  useImportKoreaHolidays,
} from '@/features/holiday/useHolidays';
import {
  HOLIDAY_TYPE_LABELS,
  type Holiday,
  type HolidayType,
} from '@/domain/holiday/schema';
import { usePermission } from '@/features/auth/usePermission';

const YEAR_OPTIONS: Option[] = [
  { value: 'all', label: '전체 년도' },
  { value: '2025', label: '2025년' },
  { value: '2026', label: '2026년 (금년)' },
  { value: '2027', label: '2027년' },
];

const TYPE_OPTIONS: Option[] = [
  { value: 'all', label: '전체 구분' },
  { value: 'legal', label: '법정 공휴일' },
  { value: 'substitute', label: '대체 공휴일' },
  { value: 'company', label: '회사 지정 휴일' },
  { value: 'special', label: '임시 공휴일' },
];

const DAY_NAMES = ['일', '월', '화', '수', '목', '금', '토'];

export default function HolidayScreen() {
  const { canAction } = usePermission();
  const canCreate = canAction('S_BASE_HOLIDAY', 'create');
  const canUpdate = canAction('S_BASE_HOLIDAY', 'update');
  const canDelete = canAction('S_BASE_HOLIDAY', 'delete');

  const [year, setYear] = useState('2026');
  const [typeFilter, setTypeFilter] = useState('all');
  const [keyword, setKeyword] = useState('');

  const { data: holidays = [], isLoading } = useHolidays(year);
  const createHoliday = useCreateHoliday();
  const updateHoliday = useUpdateHoliday();
  const deleteHoliday = useDeleteHoliday();
  const resetHolidays = useResetHolidays();
  const importKoreaHolidays = useImportKoreaHolidays();

  // 모달 상태
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formDate, setFormDate] = useState('2026-01-01');
  const [formName, setFormName] = useState('');
  const [formType, setFormType] = useState<HolidayType>('company');
  const [formIsPaid, setFormIsPaid] = useState(true);
  const [formMemo, setFormMemo] = useState('');

  // 필터링된 공휴일 목록
  const filtered = useMemo(() => {
    let list = holidays;
    if (typeFilter !== 'all') {
      list = list.filter((h) => h.type === typeFilter);
    }
    const q = keyword.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (h) =>
          h.name.toLowerCase().includes(q) ||
          h.date.includes(q) ||
          (h.memo && h.memo.toLowerCase().includes(q)),
      );
    }
    return list;
  }, [holidays, typeFilter, keyword]);

  const handleOpenCreate = () => {
    setEditingId(null);
    const today = new Date().toISOString().split('T')[0];
    setFormDate(year !== 'all' ? `${year}-05-01` : today);
    setFormName('');
    setFormType('company');
    setFormIsPaid(true);
    setFormMemo('');
    setIsModalOpen(true);
  };

  const handleOpenEdit = (h: Holiday) => {
    setEditingId(h.id);
    setFormDate(h.date);
    setFormName(h.name);
    setFormType(h.type);
    setFormIsPaid(h.isPaid);
    setFormMemo(h.memo || '');
    setIsModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formDate.trim()) {
      alert('날짜를 입력해주세요.');
      return;
    }
    if (!formName.trim()) {
      alert('휴일 명칭을 입력해주세요.');
      return;
    }

    try {
      if (editingId) {
        await updateHoliday.mutateAsync({
          id: editingId,
          patch: {
            date: formDate.trim(),
            name: formName.trim(),
            type: formType,
            isPaid: formIsPaid,
            memo: formMemo.trim() || undefined,
          },
        });
      } else {
        await createHoliday.mutateAsync({
          date: formDate.trim(),
          name: formName.trim(),
          type: formType,
          isPaid: formIsPaid,
          memo: formMemo.trim() || undefined,
        });
      }
      setIsModalOpen(false);
    } catch (err: any) {
      alert(`저장 실패: ${err.message || err}`);
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`'${name}' 공휴일을 삭제하시겠습니까?`)) return;
    try {
      await deleteHoliday.mutateAsync(id);
    } catch (err: any) {
      alert(`삭제 실패: ${err.message || err}`);
    }
  };

  const handleImportKoreaHolidays = async () => {
    const targetYear = year !== 'all' ? year : '2026';
    if (
      !confirm(
        `[${targetYear}년] 대한민국 법정 공휴일 및 대체 공휴일 목록을 일괄 등록하시겠습니까?\n(이미 등록된 공휴일은 최신 명칭과 규정으로 자동 업데이트됩니다.)`,
      )
    ) {
      return;
    }
    try {
      const res = await importKoreaHolidays.mutateAsync(targetYear);
      alert(
        `${targetYear}년도 대한민국 공휴일 등록이 완료되었습니다.\n• 신규 등록: ${res.importedCount}건\n• 기존 갱신: ${res.updatedCount}건`,
      );
    } catch (err: any) {
      alert(`공휴일 불러오기 실패: ${err.message || err}`);
    }
  };

  const handleReset = async () => {
    const targetYear = year !== 'all' ? year : '2026';
    if (!confirm(`공휴일 데이터를 [${targetYear}년] 대한민국 법정 공휴일 초기 표준 데이터로 복원하시겠습니까?`)) {
      return;
    }
    try {
      await resetHolidays.mutateAsync(targetYear);
      alert('공휴일 데이터가 초기화되었습니다.');
    } catch (err: any) {
      alert(`초기화 실패: ${err.message || err}`);
    }
  };

  const handleExportCsv = () => {
    const headers = ['날짜', '요일', '휴일명', '구분', '유급여부', '비고'];
    const rows = filtered.map((h) => {
      const d = new Date(`${h.date}T00:00:00`);
      const dayName = DAY_NAMES[d.getDay()] || '';
      return [
        h.date,
        dayName,
        `"${h.name.replace(/"/g, '""')}"`,
        HOLIDAY_TYPE_LABELS[h.type],
        h.isPaid ? '유급' : '무급',
        `"${(h.memo || '').replace(/"/g, '""')}"`,
      ];
    });
    const csvContent = '\uFEFF' + [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `공휴일목록_${year !== 'all' ? year : '전체'}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="flex flex-col gap-4 max-w-7xl mx-auto pb-16">
      {/* ── 화면 헤더 ── */}
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-border pb-4">
        <div>
          <div className="text-xs font-medium text-ink3 mb-1">
            기준 정보 <span className="px-1">/</span> 조직·결재 기준정보
          </div>
          <div className="flex items-center gap-2.5">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-teal-soft text-lg text-teal">
              📅
            </span>
            <h1 className="text-xl font-extrabold tracking-tight text-ink">공휴일 관리</h1>
            <span className="rounded-full bg-panel-alt px-2.5 py-0.5 text-xs font-mono font-semibold text-ink2 border border-border">
              {filtered.length}건
            </span>
          </div>
          <p className="mt-1 text-xs text-ink3">
            대한민국 법정공휴일, 대체공휴일 및 사내 창립기념일 등 회사 지정 휴일을 등록하고 근태/휴가에 연동합니다.
          </p>
        </div>

        {/* 상단 버튼 모음 */}
        <div className="flex items-center gap-2">
          <Button size="sm" variant="secondary" onClick={handleExportCsv}>
            <span className="flex items-center gap-1.5"><Download size={14} /> CSV 다운로드</span>
          </Button>
          {canCreate && (
            <Button
              size="sm"
              variant="secondary"
              onClick={handleImportKoreaHolidays}
              disabled={importKoreaHolidays.isPending}
              title={`${year !== 'all' ? year : '2026'}년 대한민국 법정공휴일 및 대체공휴일을 DB에 일괄 등록합니다.`}
            >
              <span className="flex items-center gap-1.5 text-teal">
                <Calendar size={14} />
                {importKoreaHolidays.isPending ? '불러오는 중...' : '대한민국 공휴일 불러오기'}
              </span>
            </Button>
          )}
          {canDelete && (
            <Button size="sm" variant="secondary" onClick={handleReset}>
              <span className="flex items-center gap-1.5"><RotateCcw size={14} /> 기본값 복원</span>
            </Button>
          )}
          {canCreate && (
            <Button size="sm" variant="primary" onClick={handleOpenCreate}>
              <span className="flex items-center gap-1.5"><Plus size={14} /> 공휴일 추가</span>
            </Button>
          )}
        </div>
      </div>

      {/* ── 검색 및 필터 툴바 ── */}
      <FilterBar onSearch={() => {}}>
        <FilterField label="조회 년도">
          <Select value={year} onChange={(v) => setYear(v)} options={YEAR_OPTIONS} width={130} />
        </FilterField>
        <FilterField label="휴일 구분">
          <Select
            value={typeFilter}
            onChange={(v) => setTypeFilter(v)}
            options={TYPE_OPTIONS}
            width={130}
          />
        </FilterField>
        <FilterField label="검색어">
          <TextInput
            value={keyword}
            onChange={(v) => setKeyword(v)}
            placeholder="휴일명, 메모 검색..."
            width={180}
          />
        </FilterField>
      </FilterBar>

      {/* ── 공휴일 목록 테이블 ── */}
      <Card
        title={`${year !== 'all' ? year + '년 ' : ''}공휴일 및 회사 휴일 목록`}
        action={
          <span className="text-xs text-ink3">
            법정공휴일: {holidays.filter((h) => h.type === 'legal').length}일 · 
            대체공휴일: {holidays.filter((h) => h.type === 'substitute').length}일 · 
            회사지정: {holidays.filter((h) => h.type === 'company').length}일
          </span>
        }
        bodyClassName="p-0"
      >
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-[12px]">
            <thead>
              <tr className="border-b border-border bg-panel-alt/50 text-[11px] font-extrabold text-ink3 uppercase">
                <th className="py-3 px-4 w-36">날짜 (요일)</th>
                <th className="py-3 px-4 min-w-[150px]">휴일 명칭</th>
                <th className="py-3 px-3 w-32 text-center">구분</th>
                <th className="py-3 px-3 w-24 text-center">유급 여부</th>
                <th className="py-3 px-4 min-w-[200px]">비고 / 설명</th>
                <th className="py-3 px-4 w-28 text-center">관리</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.map((h) => {
                const dateObj = new Date(`${h.date}T00:00:00`);
                const dayNum = dateObj.getDay();
                const dayName = DAY_NAMES[dayNum] || '';
                const isSunday = dayNum === 0;
                const isSaturday = dayNum === 6;

                return (
                  <tr key={h.id} className="hover:bg-panel-alt/30 transition-colors">
                    {/* 날짜 & 요일 */}
                    <td className="py-3 px-4 font-mono">
                      <span className="font-bold text-ink">{h.date}</span>
                      <span
                        className={`ml-1.5 font-bold text-[11px] ${
                          isSunday
                            ? 'text-rose-500'
                            : isSaturday
                            ? 'text-blue-500'
                            : 'text-ink3'
                        }`}
                      >
                        ({dayName})
                      </span>
                    </td>

                    {/* 휴일 명칭 */}
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-ink text-[12.5px]">{h.name}</span>
                        {h.isRecurring && (
                          <span className="rounded bg-panel-alt px-1.5 py-0.2 text-[9px] font-bold text-ink3">
                            매년반복
                          </span>
                        )}
                      </div>
                    </td>

                    {/* 구분 배지 */}
                    <td className="py-3 px-3 text-center">
                      <span
                        className={`inline-block rounded-full px-2.5 py-0.5 text-[10.5px] font-bold ${
                          h.type === 'legal'
                            ? 'bg-rose-500/10 text-rose-600 border border-rose-500/20'
                            : h.type === 'substitute'
                            ? 'bg-amber-500/10 text-amber-600 border border-amber-500/20'
                            : h.type === 'company'
                            ? 'bg-teal-soft text-teal border border-teal/20'
                            : 'bg-blue-500/10 text-blue-600 border border-blue-500/20'
                        }`}
                      >
                        {HOLIDAY_TYPE_LABELS[h.type]}
                      </span>
                    </td>

                    {/* 유급 여부 */}
                    <td className="py-3 px-3 text-center font-bold">
                      {h.isPaid ? (
                        <span className="text-teal">유급</span>
                      ) : (
                        <span className="text-ink3">무급</span>
                      )}
                    </td>

                    {/* 비고 */}
                    <td className="py-3 px-4 text-ink3 text-[11.5px]">
                      {h.memo || '—'}
                    </td>

                    {/* 액션 (수정 / 삭제) */}
                    <td className="py-3 px-4 text-center">
                      <div className="flex items-center justify-center gap-1">
                        {canUpdate && (
                          <button
                            type="button"
                            onClick={() => handleOpenEdit(h)}
                            className="rounded-lg p-1 text-xs text-ink3 hover:bg-teal-soft hover:text-teal transition-colors"
                            title="수정"
                          >
                            <Pencil size={14} />
                          </button>
                        )}
                        {canDelete && (
                          <button
                            type="button"
                            onClick={() => handleDelete(h.id, h.name)}
                            className="rounded-lg p-1 text-xs text-ink3 hover:bg-danger/10 hover:text-danger transition-colors"
                            title="삭제"
                          >
                            <Trash2 size={14} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}

              {filtered.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-ink3">
                    {isLoading ? '공휴일 데이터를 불러오는 중...' : '등록된 공휴일 정보가 없습니다.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* ── 공휴일 등록 / 수정 모달 ── */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4 animate-in fade-in duration-150">
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md rounded-3xl border border-border bg-panel p-6 shadow-2xl animate-in zoom-in-95 duration-200"
          >
            <div className="flex items-center justify-between border-b border-border pb-3.5">
              <h2 className="text-base font-extrabold text-ink flex items-center gap-2">
                {editingId ? (
                  <span className="flex items-center gap-1.5"><Pencil size={16} className="text-teal" /> 공휴일 정보 수정</span>
                ) : (
                  <span className="flex items-center gap-1.5"><Calendar size={16} className="text-teal" /> 신규 공휴일 등록</span>
                )}
              </h2>
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="rounded-lg p-1 text-ink3 hover:bg-panel-alt hover:text-ink"
              >
                <X size={16} />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="mt-4 space-y-4">
              {/* 날짜 선택 */}
              <div>
                <label className="block text-[11.5px] font-bold text-ink2 mb-1.5">휴일 날짜 *</label>
                <input
                  type="date"
                  value={formDate}
                  onChange={(e) => setFormDate(e.target.value)}
                  className="h-10 w-full rounded-xl border border-border bg-panel-alt/50 px-3 text-[12.5px] text-ink outline-none focus:border-teal"
                  required
                />
              </div>

              {/* 휴일 명칭 */}
              <div>
                <label className="block text-[11.5px] font-bold text-ink2 mb-1.5">휴일 명칭 *</label>
                <input
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder="예: 회사 창립기념일, 신정, 설날 연휴"
                  className="h-10 w-full rounded-xl border border-border bg-panel-alt/50 px-3 text-[12.5px] text-ink outline-none focus:border-teal"
                  autoFocus
                  required
                />
              </div>

              {/* 휴일 구분 */}
              <div>
                <label className="block text-[11.5px] font-bold text-ink2 mb-1.5">휴일 구분 *</label>
                <select
                  value={formType}
                  onChange={(e) => setFormType(e.target.value as HolidayType)}
                  className="h-10 w-full rounded-xl border border-border bg-panel-alt/50 px-3 text-[12.5px] text-ink outline-none focus:border-teal"
                >
                  <option value="legal">법정 공휴일</option>
                  <option value="substitute">대체 공휴일</option>
                  <option value="company">회사 지정 휴일</option>
                  <option value="special">임시 공휴일</option>
                </select>
              </div>

              {/* 유급 여부 */}
              <div className="flex items-center gap-2 pt-1">
                <input
                  type="checkbox"
                  id="chkIsPaid"
                  checked={formIsPaid}
                  onChange={(e) => setFormIsPaid(e.target.checked)}
                  className="h-4 w-4 rounded border-border text-teal focus:ring-teal"
                />
                <label htmlFor="chkIsPaid" className="text-[12px] font-bold text-ink cursor-pointer">
                  유급 휴일로 적용 (급여 산정 시 포함)
                </label>
              </div>

              {/* 비고 / 메모 */}
              <div>
                <label className="block text-[11.5px] font-bold text-ink2 mb-1.5">
                  비고 / 설명 (선택)
                </label>
                <input
                  value={formMemo}
                  onChange={(e) => setFormMemo(e.target.value)}
                  placeholder="휴일 지정 사유나 관련 안내 사항..."
                  className="h-10 w-full rounded-xl border border-border bg-panel-alt/50 px-3 text-[12px] text-ink outline-none focus:border-teal"
                />
              </div>

              {/* 모달 하단 버튼 */}
              <div className="flex justify-end gap-2 border-t border-border pt-4">
                <Button
                  type="button"
                  variant="secondary"
                  size="md"
                  onClick={() => setIsModalOpen(false)}
                >
                  취소
                </Button>
                <Button type="submit" variant="primary" size="md">
                  {editingId ? '수정 완료' : '등록 완료'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
