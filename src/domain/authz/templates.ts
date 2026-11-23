/** 새 역할 서식 — 권한 체크만 채워 준다 */
export const ROLE_TEMPLATES: { id: string; name: string; desc: string; permissions: string[] }[] = [
  { id: 'blank', name: '빈 역할', desc: '권한 없이 시작', permissions: [] },
  {
    id: 'people',
    name: '인사 관리자',
    desc: '사용자·인사 정보·부서·직급 관리, 연차 가감·근무 정책 관리, 공휴일 보기',
    permissions: ['admin.user.manage', 'admin.people.manage', 'admin.org.manage', 'admin.position.manage', 'admin.leave.manage', 'admin.holiday.view'],
  },
  {
    id: 'approval',
    name: '결재 관리자',
    desc: '결재서식·결재선 규칙·결재 프로세스 관리, 결재문서 모니터링',
    permissions: ['admin.approval.form.manage', 'admin.approval.rule.manage', 'admin.approval.process.manage', 'admin.approval.monitor'],
  },
  {
    id: 'ops',
    name: '운영 관리자',
    desc: '회사 정보·공휴일·공통코드 관리, 로그·인터페이스 보기',
    permissions: ['admin.company.manage', 'admin.holiday.manage', 'admin.code.manage', 'admin.log.view', 'admin.interface.view'],
  },
];
