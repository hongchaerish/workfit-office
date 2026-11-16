import { z } from 'zod';
import { bizNoDigits, formatBizNo, isValidBizNoChecksum } from '@/domain/bizVendor/schema';
import { isValidEmail, isValidHomepage } from './inputFormat';

/**
 * 기업 정보(업무 기준정보) — 도입기업·매입기업을 가리지 않는 기업 마스터.
 * 도입/매입은 기업이 아니라 프로젝트 참여에 붙는다(다음 단계). 설계: docs/superpowers/specs/2026-11-13-biz-company-master-design.md
 */
export { bizNoDigits, formatBizNo, isValidBizNoChecksum };

const audit = {
  createdBy: z.string().default(''),
  createdAt: z.string().default(''),
  updatedBy: z.string().default(''),
  updatedAt: z.string().default(''),
};

/**
 * 선택 글자 칸 — 없거나 null 이면 빈 값. DB에 칸을 새로 만들면 예전 문서는 그 칸이 null 로 오는데,
 * 그대로 두면 읽기 검사에 걸려 기업이 목록에서 통째로 빠진다.
 */
const text = () => z.preprocess((v) => v ?? '', z.string());

/** 기업. bizNo 는 숫자 10자리만 저장(표시는 formatBizNo). */
export const companySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  bizNo: text(),
  ceoName: text(),
  phone: text(),
  fax: text(),
  email: text(),
  homepage: text(),
  address: text(),
  addressDetail: text(),
  use: z.boolean().default(true),
  note: text(),
  ...audit,
});
export type Company = z.infer<typeof companySchema>;

/** 기업 계좌 — 기업당 여러 개. 은행 이름은 저장하지 않고 공통코드(BANK)에서 찾는다. */
export const companyBankAccountSchema = z.object({
  id: z.string().min(1),
  companyId: z.string().min(1),
  bankCode: z.string().default(''),
  accountNo: z.string().default(''),
  holder: z.string().default(''),
  isDefault: z.boolean().default(false),
  use: z.boolean().default(true),
  note: z.string().default(''),
  ...audit,
});
export type CompanyBankAccount = z.infer<typeof companyBankAccountSchema>;

/** 기업 첨부파일 — 이번엔 자리만(화면 없음). */
export const COMPANY_FILE_KINDS = ['BIZ_REG', 'BANKBOOK', 'ETC'] as const;
export const companyFileSchema = z.object({
  id: z.string().min(1),
  companyId: z.string().min(1),
  kind: z.enum(COMPANY_FILE_KINDS),
  accountId: z.string().default(''),
  name: z.string().default(''),
  url: z.string().default(''),
  storagePath: z.string().default(''),
  size: z.number().int().nonnegative().default(0),
  contentType: z.string().default(''),
  uploadedBy: z.string().default(''),
  uploadedAt: z.string().default(''),
});
export type CompanyFile = z.infer<typeof companyFileSchema>;

const rid = (p: string) => `${p}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
export const newCompanyId = () => rid('CMP');
export const newAccountId = () => rid('CBA');
export const newCompanyFileId = () => rid('CFL');

export type CompanyDraft = Pick<Company, 'name' | 'bizNo' | 'ceoName' | 'phone' | 'fax' | 'email' | 'homepage' | 'address' | 'addressDetail' | 'note' | 'use'>;

export const EMAIL_FORMAT_ERROR = '이메일 형식을 확인하세요. (예: tax@company.co.kr)';
export const HOMEPAGE_FORMAT_ERROR = '홈페이지 주소를 확인하세요. (예: www.company.co.kr)';
export interface AccountDraft {
  id?: string;
  bankCode: string;
  accountNo: string;
  holder: string;
  isDefault: boolean;
  use: boolean;
  note: string;
}

/** 같은 사업자등록번호의 기업(사용 안 함 포함). 숫자만 비교. */
export function findCompanyByBizNo(companies: Company[], bizNo: string, excludeId?: string): Company | undefined {
  const d = bizNoDigits(bizNo);
  if (!d) return undefined;
  return companies.find((c) => c.id !== excludeId && bizNoDigits(c.bizNo) === d);
}

export function validateCompanyDraft(
  draft: CompanyDraft,
  all: Company[],
  excludeId?: string,
): { errors: string[]; warnings: string[]; duplicate?: Company } {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!draft.name.trim()) errors.push('기업명을 입력하세요.');
  const d = bizNoDigits(draft.bizNo);
  if (!d) errors.push('사업자등록번호를 입력하세요.');
  else if (d.length !== 10) errors.push('사업자등록번호는 숫자 10자리입니다.');
  else if (!isValidBizNoChecksum(d)) warnings.push('사업자등록번호 검증식에 맞지 않습니다. 번호를 다시 확인하세요.');
  if (!isValidEmail(draft.email)) errors.push(EMAIL_FORMAT_ERROR);
  if (!isValidHomepage(draft.homepage)) errors.push(HOMEPAGE_FORMAT_ERROR);
  const duplicate = d.length === 10 ? findCompanyByBizNo(all, d, excludeId) : undefined;
  if (duplicate) {
    errors.push(
      duplicate.use
        ? `이미 등록된 사업자등록번호입니다(${duplicate.name}).`
        : `이미 등록된 사업자등록번호입니다(${duplicate.name}, 사용 안 함). 그 기업을 다시 사용으로 바꾸세요.`,
    );
  }
  return { errors, warnings, duplicate };
}

/** 기본 계좌 — 사용 중 계좌 중 정확히 하나(처음 표시된 것, 없으면 첫 사용 중). 사용 안 함은 기본 아님. */
export function normalizeDefaultAccount<T extends { use: boolean; isDefault: boolean }>(rows: T[]): T[] {
  let picked = rows.findIndex((r) => r.use && r.isDefault);
  if (picked < 0) picked = rows.findIndex((r) => r.use);
  return rows.map((r, i) => ({ ...r, isDefault: i === picked }));
}

export function validateAccountDrafts(rows: AccountDraft[]): string[] {
  const errors: string[] = [];
  rows.forEach((r, i) => {
    if (!r.use) return;
    const at = `${i + 1}번째 계좌: `;
    if (!r.bankCode) errors.push(`${at}은행을 고르세요.`);
    const no = r.accountNo.trim();
    if (!no) errors.push(`${at}계좌번호를 입력하세요.`);
    else if (!/^[0-9-]+$/.test(no)) errors.push(`${at}계좌번호는 숫자와 - 만 쓸 수 있습니다.`);
    if (!r.holder.trim()) errors.push(`${at}예금주를 입력하세요.`);
  });
  return errors;
}
