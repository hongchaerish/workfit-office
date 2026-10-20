import { z } from 'zod';
import type { Vendor } from '@/domain/vendor/schema';
import type { WorkProject, WorkProjectStatus } from '@/domain/workProject/schema';

/**
 * 사업관리 — 도입기업 ↔ 사업(프로젝트) 연결.
 *
 * 도입기업은 기존 `vendors`, 사업은 업무관리의 `workProjects` 를 그대로 쓴다(중복 데이터 금지).
 * 둘을 잇는 건 별도 연결표 `bizVendorProjects` 하나뿐이라 기존 컬렉션은 건드리지 않는다.
 * 한 사업에 발주처·매입처·외주처가 여럿 붙을 수 있어 프로젝트 칸 하나가 아니라 표로 둔다.
 */
export const VENDOR_PROJECT_ROLES = ['발주처', '매입처', '외주'] as const;
export type VendorProjectRole = (typeof VENDOR_PROJECT_ROLES)[number];

export const vendorProjectLinkSchema = z.object({
  /** `${vendorCode}__${projectId}` — 같은 도입기업·사업을 두 번 잇지 못하게 한다. */
  id: z.string().min(1),
  vendorCode: z.string().min(1),
  projectId: z.string().min(1),
  role: z.enum(VENDOR_PROJECT_ROLES),
  note: z.string().max(200).default(''),
  createdBy: z.string().min(1),
  createdAt: z.string().datetime(),
});
export type VendorProjectLink = z.infer<typeof vendorProjectLinkSchema>;

export function vendorProjectLinkId(vendorCode: string, projectId: string): string {
  return `${vendorCode}__${projectId}`;
}

/** 진행 중으로 보는 상태 — 완료·보관은 지난 사업. */
const ONGOING: ReadonlySet<WorkProjectStatus> = new Set(['PLANNING', 'ACTIVE', 'ON_HOLD']);
export function isOngoingProject(p: Pick<WorkProject, 'status'>): boolean {
  return ONGOING.has(p.status);
}

export interface VendorProjectRow {
  project: WorkProject;
  /** 연결표에 있으면 그 역할, 없으면 발주처명 일치로 찾은 것. */
  role: VendorProjectRole;
  /** 'link' = 연결표, 'clientName' = 프로젝트 발주처명이 도입기업명과 같아 자동으로 보인 것. */
  source: 'link' | 'clientName';
  linkId: string | null;
}

/** 이름 비교용 — 공백·(주)·주식회사 표기 차이를 무시한다. */
export function normalizeCompanyName(name: string): string {
  return name
    .normalize('NFC')
    .replace(/\(주\)|㈜|주식회사|\(유\)|유한회사/g, '')
    .replace(/\s+/g, '')
    .toLowerCase();
}

/**
 * 도입기업의 사업 목록 — 연결표 + (연결 안 된) 발주처명 일치 사업.
 * 발주처명 일치는 연결을 만들기 전 기존 프로젝트도 보이게 하려는 것이다. 정식 연결이 있으면 그쪽이 우선.
 */
export function projectsOfVendor(
  vendor: Pick<Vendor, 'code' | 'name'>,
  links: VendorProjectLink[],
  projects: WorkProject[],
): VendorProjectRow[] {
  const byId = new Map(projects.map((p) => [p.id, p]));
  const rows: VendorProjectRow[] = [];
  const seen = new Set<string>();
  for (const l of links) {
    if (l.vendorCode !== vendor.code) continue;
    const project = byId.get(l.projectId);
    if (!project) continue; // 볼 수 없거나 지워진 사업
    rows.push({ project, role: l.role, source: 'link', linkId: l.id });
    seen.add(project.id);
  }
  const key = normalizeCompanyName(vendor.name);
  if (key) {
    for (const p of projects) {
      if (seen.has(p.id) || !p.clientName) continue;
      if (normalizeCompanyName(p.clientName) === key) rows.push({ project: p, role: '발주처', source: 'clientName', linkId: null });
    }
  }
  return rows.sort((a, b) => Number(isOngoingProject(b.project)) - Number(isOngoingProject(a.project)) || a.project.code.localeCompare(b.project.code));
}

/** 사업자번호 숫자만. */
export function bizNoDigits(bizNo: string): string {
  return bizNo.replace(/\D/g, '');
}

/** `000-00-00000` 형식으로. 10자리가 아니면 입력 그대로. */
export function formatBizNo(bizNo: string): string {
  const d = bizNoDigits(bizNo);
  return d.length === 10 ? `${d.slice(0, 3)}-${d.slice(3, 5)}-${d.slice(5)}` : bizNo.trim();
}

/** 국세청 사업자등록번호 검증식(마지막 자리 검증번호). */
export function isValidBizNoChecksum(bizNo: string): boolean {
  const d = bizNoDigits(bizNo);
  if (d.length !== 10) return false;
  const n = [...d].map(Number);
  const w = [1, 3, 7, 1, 3, 7, 1, 3, 5];
  let sum = w.reduce((s, wi, i) => s + n[i] * wi, 0);
  sum += Math.floor((n[8] * 5) / 10);
  return (10 - (sum % 10)) % 10 === n[9];
}

/** 다음 도입기업코드 — 기존 `V-숫자` 최댓값 + 1 (최소 V-10001). */
export function nextVendorCode(codes: string[]): string {
  const max = codes.reduce((m, c) => {
    const n = /^V-(\d+)$/.exec(c)?.[1];
    return n ? Math.max(m, Number(n)) : m;
  }, 10000);
  return `V-${max + 1}`;
}

/** 같은 사업자번호를 쓰는 다른 도입기업(자기 자신 제외). 비어 있으면 검사하지 않는다. */
export function findDuplicateBizNo(vendors: Vendor[], bizNo: string, selfCode?: string): Vendor | null {
  const d = bizNoDigits(bizNo);
  if (!d) return null;
  return vendors.find((v) => v.code !== selfCode && bizNoDigits(v.bizNo) === d) ?? null;
}
