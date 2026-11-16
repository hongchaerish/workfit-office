import { Modal } from '@/shared/ui/Modal';
import { Button } from '@/shared/ui/Button';
import { Pill } from '@/shared/ui/Pill';
import { formatBizNo, type Company, type CompanyBankAccount } from '@/domain/company/schema';
import { homepageHref } from '@/domain/company/inputFormat';
import { useBankNames } from '@/features/company/useCompanies';
import { bizTd, bizTh } from '../_biz';

/** 기업 상세 — 기업 정보와 계좌(사용 중 먼저, 기본 표시). */
export function CompanyDetailModal({
  company,
  accounts,
  canEdit,
  onEdit,
  onClose,
}: {
  company: Company;
  accounts: CompanyBankAccount[];
  canEdit: boolean;
  onEdit: () => void;
  onClose: () => void;
}) {
  const bankNames = useBankNames();
  const list = [...accounts].sort((a, b) => Number(b.use) - Number(a.use) || Number(b.isDefault) - Number(a.isDefault));
  const info: [string, string, boolean?][] = [
    ['사업자등록번호', formatBizNo(company.bizNo) || '-'],
    ['대표자', company.ceoName || '-'],
    ['대표번호', company.phone || '-'],
    ['팩스', company.fax || '-'],
    ['이메일', company.email || '-'],
    ['홈페이지', company.homepage || '-'],
    ['주소', [company.address, company.addressDetail].filter(Boolean).join(' ') || '-', true],
    ['메모', company.note || '-', true],
  ];
  const title = (
    <span className="flex items-center gap-2">
      {company.name}
      <Pill tone={company.use ? 'ok' : 'mute'}>{company.use ? '사용' : '사용 안 함'}</Pill>
    </span>
  );

  return (
    <Modal open onClose={onClose} title={title} width={760} footer={canEdit ? <Button onClick={onEdit}>기업 정보 수정</Button> : undefined}>
      <div className="flex flex-col gap-5">
        <dl className="grid grid-cols-3 gap-x-6 gap-y-3 rounded-lg border border-border bg-panel-alt/40 p-4 text-[12px]">
          {info.map(([k, v, wide]) => (
            <div key={k} className={`flex flex-col gap-0.5 ${wide ? 'col-span-3' : ''}`}>
              <dt className="text-[11px] font-bold text-ink3">{k}</dt>
              <dd className={`min-w-0 whitespace-pre-wrap break-all text-ink ${k === '사업자등록번호' ? 'font-mono' : ''}`}>
                {k === '이메일' && company.email ? (
                  <a href={`mailto:${company.email}`} className="text-teal hover:underline">{v}</a>
                ) : k === '홈페이지' && company.homepage ? (
                  <a href={homepageHref(company.homepage)} target="_blank" rel="noopener noreferrer" className="text-teal hover:underline">{v}</a>
                ) : (
                  v
                )}
              </dd>
            </div>
          ))}
        </dl>

        <section className="flex flex-col gap-2.5">
          <h3 className="text-[13px] font-extrabold text-ink">계좌 <span className="text-teal">{list.filter((a) => a.use).length}</span></h3>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr>{['은행', '계좌번호', '예금주', '메모', ''].map((h) => <th key={h} className={bizTh}>{h}</th>)}</tr>
              </thead>
              <tbody>
                {list.length === 0 && (
                  <tr><td colSpan={5} className="px-3 py-8 text-center text-[12px] text-ink3">등록된 계좌가 없습니다.</td></tr>
                )}
                {list.map((a) => (
                  <tr key={a.id} className={a.use ? '' : 'opacity-50'}>
                    <td className={`${bizTd} font-bold text-ink`}>{bankNames.get(a.bankCode) ?? '-'}</td>
                    <td className={`${bizTd} font-mono text-ink`}>{a.accountNo}</td>
                    <td className={`${bizTd} text-ink2`}>{a.holder}</td>
                    <td className={`${bizTd} text-ink3`}>{a.note || '-'}</td>
                    <td className={`${bizTd} text-center`}>
                      {a.use ? (a.isDefault ? <Pill tone="info">기본</Pill> : null) : <Pill tone="mute">사용 안 함</Pill>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </Modal>
  );
}
