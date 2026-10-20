import assert from 'node:assert/strict';
import test from 'node:test';
import type { Vendor } from '@/domain/vendor/schema';
import type { WorkProject } from '@/domain/workProject/schema';
import {
  findDuplicateBizNo,
  formatBizNo,
  isValidBizNoChecksum,
  nextVendorCode,
  normalizeCompanyName,
  projectsOfVendor,
  vendorProjectLinkId,
  type VendorProjectLink,
} from './schema';

const vendor = (code: string, name: string, bizNo = ''): Vendor =>
  ({ code, name, type: '매입', use: '사용', bizNo, ceo: '', manager: '', addr: '' });
const project = (id: string, over: Partial<WorkProject> = {}): WorkProject =>
  ({ id, code: id.replace('PRJ', 'P'), name: id, status: 'ACTIVE', clientName: null, ...over }) as WorkProject;
const link = (vendorCode: string, projectId: string, role: VendorProjectLink['role'] = '발주처'): VendorProjectLink => ({
  id: vendorProjectLinkId(vendorCode, projectId), vendorCode, projectId, role, note: '', createdBy: 'U1', createdAt: '2026-10-20T00:00:00.000Z',
});

test('회사명 비교는 (주)·주식회사·공백을 무시한다', () => {
  assert.equal(normalizeCompanyName('대성반도체(주)'), normalizeCompanyName('주식회사 대성 반도체'));
  assert.notEqual(normalizeCompanyName('대성반도체'), normalizeCompanyName('대성정밀'));
});

test('거래처 사업 = 연결표 + 연결 안 된 발주처명 일치 사업, 진행 중이 먼저', () => {
  const v = vendor('V-1', '대성반도체(주)');
  const projects = [
    project('PRJ-0001', { status: 'COMPLETED' }),
    project('PRJ-0002', { clientName: '대성반도체' }),
    project('PRJ-0003', { clientName: '대성반도체', status: 'ACTIVE' }),
    project('PRJ-0004', { clientName: '한울정밀' }),
  ];
  const rows = projectsOfVendor(v, [link('V-1', 'PRJ-0001', '매입처'), link('V-1', 'PRJ-0003', '외주'), link('V-2', 'PRJ-0004')], projects);
  assert.deepEqual(rows.map((r) => [r.project.id, r.role, r.source]), [
    ['PRJ-0002', '발주처', 'clientName'],
    ['PRJ-0003', '외주', 'link'], // 연결이 있으면 발주처명 일치보다 우선, 중복 없음
    ['PRJ-0001', '매입처', 'link'], // 완료 사업은 뒤로
  ]);
});

test('볼 수 없는(목록에 없는) 사업의 연결은 건너뛴다', () => {
  assert.equal(projectsOfVendor(vendor('V-1', 'A'), [link('V-1', 'PRJ-9999')], []).length, 0);
});

test('사업자번호 형식·검증번호', () => {
  assert.equal(formatBizNo('1248100998'), '124-81-00998');
  assert.equal(isValidBizNoChecksum('124-81-00998'), true); // 실제 형식에 맞는 번호
  assert.equal(isValidBizNoChecksum('124-81-00999'), false);
  assert.equal(isValidBizNoChecksum('12345'), false);
});

test('다음 거래처코드와 사업자번호 중복 검사', () => {
  assert.equal(nextVendorCode(['V-10021', 'V-50880', 'X-1']), 'V-50881');
  assert.equal(nextVendorCode([]), 'V-10001');
  const vs = [vendor('V-1', 'A', '124-81-00998'), vendor('V-2', 'B')];
  assert.equal(findDuplicateBizNo(vs, '1248100998')?.code, 'V-1');
  assert.equal(findDuplicateBizNo(vs, '1248100998', 'V-1'), null); // 자기 자신은 제외
  assert.equal(findDuplicateBizNo(vs, ''), null);
});
