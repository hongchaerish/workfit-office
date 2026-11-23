import EmployeeScreen from '@/modules/gw/employee/EmployeeScreen';

/** 관리자 콘솔 › 구성원·조직 › 인사 정보 — 인명관리 화면의 관리 모드(발령·수정·퇴직·개인 신상) */
export default function PeopleInfoScreen() {
  return <EmployeeScreen mode="manage" />;
}
