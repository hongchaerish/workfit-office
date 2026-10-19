import { type User } from '@/domain/user/schema';

/**
 * 사용자 시드 — Firebase 미설정 시 폴백 + 초기 seed 소스.
 * Workfit Office 실제 조직도 기준 실명 재직자 10명. 조직도 상 '충원(공석)' 자리는 제외.
 * position = 직급(직급 마스터와 매칭). jobTitle = 직책(팀장·본부장·팀원 등, 조직도 직책열).
 * 팀장/본부장 직책은 department.headUserId 와도 연동. managerId = 직속 상급자(상급자 체인 원천).
 *
 * ⚠ password 는 데모 한정 평문. 전 계정 공통 초기 비밀번호 `mes1234`.
 *   자체 로그인(사번 또는 이메일 + 비밀번호). ([[firebase-backend-setup]])
 */
const DEMO_PW = '06c4371239ef075e099d6d84de05e43ad7f649fc75350eac00ce55bc859cf218';

export const USER_SEED: Omit<User, 'sealUrl' | 'photoUrl' | 'signUrl' | 'signType' | 'resignedAt' | 'fcmToken' | 'assignments'>[] = [
  // 대표이사
  { id: 'U001', empNo: '100001', name: '박영미', dept: '대표이사', position: '대표이사', jobTitle: '대표이사', email: 'ympark@workfit.kr', status: '사용', lastLogin: '2026-07-07 08:40', managerId: null, password: DEMO_PW },
  // AX지능화본부 — 직책 본부장 / 직급 상무이사
  { id: 'U003', empNo: '200001', name: '손승원', dept: 'AX지능화본부', position: '상무이사', jobTitle: '본부장', email: 'smartfactory@workfit.kr', status: '사용', lastLogin: '2026-07-07 09:02', managerId: 'U001', password: DEMO_PW },
  // 품질심사팀 — 팀장 강윤석(직급 이사)
  { id: 'U006', empNo: '300001', name: '강윤석', dept: '품질심사팀', position: '이사', jobTitle: '팀장', email: 'yskang@workfit.kr', status: '사용', lastLogin: '2026-07-07 08:12', managerId: 'U003', password: DEMO_PW },
  { id: 'U007', empNo: '300002', name: '최지혜', dept: '품질심사팀', position: '사원', jobTitle: '팀원', email: 'jhchoi@workfit.kr', status: '사용', lastLogin: '2026-07-06 17:55', managerId: 'U006', password: DEMO_PW },
  // AX 솔루션컨설팅팀 — 팀장 홍형표(직급 부장)
  { id: 'U008', empNo: '400001', name: '홍형표', dept: 'AX 솔루션컨설팅팀', position: '부장', jobTitle: '팀장', email: 'hphong@workfit.kr', status: '사용', lastLogin: '2026-07-07 07:48', managerId: 'U003', password: DEMO_PW },
  // AX PMO팀 — 팀장 박명규(부장) / 부팀장 박광래(차장)
  { id: 'U009', empNo: '500001', name: '박명규', dept: 'AX PMO팀', position: '부장', jobTitle: '팀장', email: 'mgpark@workfit.kr', status: '사용', lastLogin: '2026-07-07 08:05', managerId: 'U003', password: DEMO_PW },
  { id: 'U010', empNo: '500002', name: '박광래', dept: 'AX PMO팀', position: '차장', jobTitle: '부팀장', email: 'grpark@workfit.kr', status: '사용', lastLogin: '2026-07-06 18:20', managerId: 'U009', password: DEMO_PW },
  // 데이터플랫폼 개발팀 — 팀장 김승기(부장)
  { id: 'U011', empNo: '600001', name: '김승기', dept: '데이터플랫폼 개발팀', position: '부장', jobTitle: '팀장', email: 'sgkim@workfit.kr', status: '사용', lastLogin: '2026-07-07 08:41', managerId: 'U003', password: DEMO_PW },
  { id: 'U012', empNo: '600002', name: '홍채원', dept: '데이터플랫폼 개발팀', position: '사원', jobTitle: '팀원', email: 'cwhong@workfit.kr', status: '사용', lastLogin: '2026-07-07 06:48', managerId: 'U011', password: DEMO_PW },
  // 테스트 전용 계정 (홍테스터, 김테스터)
  { id: 'A001', empNo: 'A001', name: '홍테스터', dept: '테스트', position: '선임연구원', jobTitle: '테스터', email: 'tester1@workfit.kr', status: '사용', lastLogin: '2026-07-28 09:00', managerId: 'U011', password: DEMO_PW },
  { id: 'A002', empNo: 'A002', name: '김테스터', dept: '테스트', position: '선임연구원', jobTitle: '테스터', email: 'tester2@workfit.kr', status: '사용', lastLogin: '2026-07-28 09:00', managerId: 'U011', password: DEMO_PW },
];

