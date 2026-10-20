import type { RoleGroup } from '@/domain/roleGroup/schema';
import { PERM_MENUS, PERM_COLS, SYSTEM_SCREENS } from '@/domain/roleGroup/schema';

const M = PERM_MENUS.length;
const C = PERM_COLS.length;
const matrix = (fn: (mi: number, ci: number) => boolean): boolean[][] =>
  Array.from({ length: M }, (_, mi) => Array.from({ length: C }, (_, ci) => fn(mi, ci)));

/** 1. 최고 관리자 (IT/시스템 전권 - 단, 전사 인사/근태 관제는 임원/팀장/인사담당자 전용으로 기본 제외) */
const adminPermissions = () => {
  const map: Record<string, any> = {};
  SYSTEM_SCREENS.forEach((s) => {
    const isHrAdminScreen = s.id === 'S_GW_COMMUTE_ADMIN' || s.id === 'S_GW_WORK_PLAN_ADMIN';
    map[s.id] = {
      access: !isHrAdminScreen,
      create: !isHrAdminScreen,
      update: !isHrAdminScreen,
      delete: !isHrAdminScreen,
    };
  });
  return map;
};

/** 2. 임원 (경영진) 권한 (그룹웨어 + 경영/운영 + 사업관리 + 결재모니터링 조회) */
const execPermissions = () => {
  const map: Record<string, any> = {};
  SYSTEM_SCREENS.forEach((s) => {
    const isGw = s.category === 'GW';
    const isExec = s.category === 'EXEC';
    const isBiz = s.category === 'BIZ';
    const isMon = ['/base/approval-monitor', '/base/user', '/base/department', '/base/position'].includes(s.url);
    const canView = isGw || isExec || isBiz || isMon;

    map[s.id] = {
      access: canView,
      create: isGw,
      update: isGw,
      delete: false,
    };
  });
  return map;
};

/** 3. 재무관리자 권한 (그룹웨어 + 사업관리(거래처 포함) 전권 + 코드 + 결재모니터링) */
const financeAdminPermissions = () => {
  const map: Record<string, any> = {};
  SYSTEM_SCREENS.forEach((s) => {
    const isGw = s.category === 'GW';
    const isBiz = s.category === 'BIZ';
    const isFinanceTarget = ['/base/code', '/base/approval-monitor', '/exec'].includes(s.url);
    const canAccess = isGw || isBiz || isFinanceTarget;

    map[s.id] = {
      access: canAccess,
      create: isGw || isBiz || s.url === '/base/code',
      update: isGw || isBiz || s.url === '/base/code',
      delete: isBiz,
    };
  });
  return map;
};

/** 4. 부서장/팀장 권한 (그룹웨어 전체 + 근태 관제 + 업무계획 종합) */
const leaderPermissions = () => {
  const map: Record<string, any> = {};
  SYSTEM_SCREENS.forEach((s) => {
    const isGw = s.category === 'GW';
    map[s.id] = {
      access: isGw,
      create: isGw,
      update: isGw,
      delete: false,
    };
  });
  return map;
};

/** 5. 일반 사원 권한 (그룹웨어 모듈 중심 기본 사용 - 관리자 전용 관제 메뉴 제외) */
const userPermissions = () => {
  const map: Record<string, any> = {};
  SYSTEM_SCREENS.forEach((s) => {
    const isAdminScreen = s.id === 'S_GW_COMMUTE_ADMIN' || s.id === 'S_GW_WORK_PLAN_ADMIN';
    const isGw = s.category === 'GW' && !isAdminScreen;
    map[s.id] = {
      access: isGw,
      create: isGw,
      update: isGw,
      delete: false,
    };
  });
  return map;
};

/** 그룹 코드 및 명칭에 따른 기본 권한 매트릭스 도출 헬퍼 */
export function getDefaultPermissionsForGroup(code: string, name = ''): Record<string, any> {
  const c = code.toUpperCase();
  const n = name.toLowerCase();
  if (c === 'ADMIN' || n.includes('관리자') || n.includes('admin')) {
    return adminPermissions();
  }
  if (c === 'EXEC' || c === 'OPERATOR' || n.includes('임원') || n.includes('운영') || n.includes('경영')) {
    return execPermissions();
  }
  if (c === 'LEADER' || n.includes('팀장') || n.includes('부서장')) {
    return leaderPermissions();
  }
  if (c === 'FINANCE_ADMIN' || c === 'FINANCE' || c === 'QC_USER' || n.includes('재무') || n.includes('회계')) {
    return financeAdminPermissions();
  }
  return userPermissions();
}

export const ROLE_GROUP_SEED: RoleGroup[] = [
  {
    id: 'ADMIN',
    code: 'ADMIN',
    name: '관리자',
    use: true,
    isSystem: true,
    desc: '시스템 전역 설정, 그룹권한 관리, 사용자 및 전사 모니터링 등 시스템 전권을 보유한 최고 관리자 그룹입니다.',
    userIds: [],
    deptIds: ['D240'], // 데이터플랫폼 개발팀 (부서 ID 기반)
    positionRanks: [],
    menuPermissions: adminPermissions(),
    members: [],
    permissions: matrix(() => true),
  },
  {
    id: 'EXEC',
    code: 'EXEC',
    name: '임원',
    use: true,
    isSystem: false,
    desc: '경영 대시보드, 전사 운영 모니터링, 영업 수주 현황 및 전사 결재문서 전체 조회·엑셀 권한을 갖는 경영진 전용 그룹입니다.',
    userIds: ['U001', 'U003'], // 대표이사, 손승원 상무 등
    deptIds: [],
    positionRanks: [1, 2], // 대표이사, 상무, 전무 등
    menuPermissions: execPermissions(),
    members: [
      { name: '손승원', code: 'swson' },
    ],
    permissions: matrix((_, ci) => ci < 6),
  },
  {
    id: 'LEADER',
    code: 'LEADER',
    name: '부서장/팀장',
    use: true,
    isSystem: false,
    desc: '그룹웨어 전 기능과 소속 부서원 근태 관제 및 팀원 업무계획 종합 모니터링 권한을 갖는 부서 책임자 그룹입니다.',
    userIds: [],
    deptIds: [],
    positionRanks: [],
    menuPermissions: leaderPermissions(),
    members: [],
    permissions: matrix((_, ci) => ci < 4),
  },
  {
    id: 'FINANCE',
    code: 'FINANCE',
    name: '재무담당자',
    use: true,
    isSystem: false,
    desc: '견적·수주·주문서 전권 관리, 거래처 및 공통코드 관리, 전사 결재 모니터링 및 재무 데이터 엑셀 추출 권한을 갖는 그룹입니다.',
    userIds: ['U008', 'U012'], // 홍형표, 홍채원 등
    deptIds: [],
    positionRanks: [],
    menuPermissions: financeAdminPermissions(),
    members: [
      { name: '홍형표', code: 'hphong' },
      { name: '홍채원', code: 'cwhong' },
    ],
    permissions: matrix((_, ci) => ci < 5),
  },
  {
    id: 'USER',
    code: 'USER',
    name: '일반사원',
    use: true,
    isSystem: true,
    desc: '모든 임직원에게 기본 부여되는 그룹웨어(전자결재, 메일, 캘린더, 근태, 게시판 등) 기본 업무 사용 그룹입니다.',
    userIds: [],
    deptIds: [],
    positionRanks: [],
    menuPermissions: userPermissions(),
    members: [
      { name: '강윤석', code: 'yskang' },
      { name: '최지혜', code: 'jihye.choi' },
    ],
    permissions: matrix((_, ci) => ci < 2),
  },
];
