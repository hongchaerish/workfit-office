import { useState, useMemo } from 'react';
import { Search, Plus, X, AlertTriangle } from 'lucide-react';
import { usePermission } from '@/features/auth/usePermission';
import { useUsers } from '@/features/user/useUsers';
import { useEmployeeProfiles, useUpsertEmployeeProfile } from '@/features/employeeProfile/useEmployeeProfiles';
import { useDepartments } from '@/features/department/useDepartments';
import { usePositions } from '@/features/position/usePositions';
import { useJobTitles } from '@/features/jobTitle/useJobTitles';
import type { EmploymentStatus } from '@/domain/employee/schema';
import { GwHead, GwSideNav, GwSplit } from '@/modules/gw/_gw';
import { Button } from '@/shared/ui/Button';
import {
  useDepartmentMembers,
  useUpsertDepartmentMember,
  useRemoveDepartmentMember,
} from '@/features/departmentMember/useDepartmentMembers';
import {
  isCommitteeDept,
  sanitizeJobTitle,
  makeDepartmentMemberId,
} from '@/domain/departmentMember/engine';

interface OrgNode {
  id: string;
  name: string;
  leaf?: boolean;
  children?: OrgNode[];
}

export default function EmployeeScreen() {
  const { isAdmin } = usePermission();
  const { data: users = [], isLoading: isUsersLoading } = useUsers();
  const { data: employeeProfiles = [] } = useEmployeeProfiles();
  const { data: departments = [] } = useDepartments();
  const { data: positions = [] } = usePositions();
  const { data: jobTitles = [] } = useJobTitles();
  const upsertEmployeeProfile = useUpsertEmployeeProfile();
  const { data: departmentMembers = [] } = useDepartmentMembers();
  const upsertDeptMember = useUpsertDepartmentMember();
  const removeDeptMember = useRemoveDepartmentMember();

  // 대분류 탭: 'list' (임직원 관리) | 'org' (조직도)
  const [activeTab, setActiveTab] = useState<'list' | 'org'>('list');

  // 필터 및 검색 상태
  const [searchQuery, setSearchQuery] = useState('');
  const [deptFilter, setDeptFilter] = useState('all');
  const [posFilter, setPosFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('ACTIVE'); // 기본 재직자만 보기
  const [attendanceTargetFilter, setAttendanceTargetFilter] = useState<'all' | 'target' | 'excluded'>('all'); // 근태관리 대상 필터

  // 상세 보기 및 편집 대상
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);

  // 겸직 등록 폼 상태
  const [newConcDeptId, setNewConcDeptId] = useState('');
  const [newConcJobTitle, setNewConcJobTitle] = useState('팀원');

  // 조직도 선택 부서 상태
  const [selectedDept, setSelectedDept] = useState<string>('all');

  // 신규 등록 폼 상태 (사용자 관리 연동)
  const [selectedCreateUserId, setSelectedCreateUserId] = useState('');
  const [newEmpNo, setNewEmpNo] = useState('');
  const [newEmpName, setNewEmpName] = useState('');
  const [newEmpDept, setNewEmpDept] = useState('');
  const [newEmpPos, setNewEmpPos] = useState('');
  const [newEmpDuty, setNewEmpDuty] = useState('');
  const [newEmpEmail, setNewEmpEmail] = useState('');
  const [newEmpPhone, setNewEmpPhone] = useState('');
  const [newEmpHireDate, setNewEmpHireDate] = useState('');
  const [newEmpRrn, setNewEmpRrn] = useState('');
  const [newEmpAddress, setNewEmpAddress] = useState('');
  const [newEmpPersonalEmail, setNewEmpPersonalEmail] = useState('');
  const [newEmpEmergencyPhone, setNewEmpEmergencyPhone] = useState('');
  const [newEmpEducation, setNewEmpEducation] = useState('');
  const [newEmpIsAttendanceTarget, setNewEmpIsAttendanceTarget] = useState(true);

  // 발령 대상 계정 선택 핸들러
  const handleSelectCreateUser = (userId: string) => {
    setSelectedCreateUserId(userId);
    const u = users.find((user) => user.id === userId);
    if (!u) {
      setNewEmpNo('');
      setNewEmpName('');
      setNewEmpEmail('');
      setNewEmpIsAttendanceTarget(true);
      return;
    }
    const targetDeptName = u.dept && u.dept !== '미지정' ? u.dept : departments[0]?.name || '인사지원팀';
    const targetDeptObj = departments.find((d) => d.name === targetDeptName);
    const isComm = isCommitteeDept(targetDeptObj || targetDeptName);

    setNewEmpNo(u.empNo);
    setNewEmpName(u.name);
    setNewEmpEmail(u.email);
    setNewEmpDept(targetDeptName);
    setNewEmpPos(u.position && u.position !== '사원' ? u.position : positions[0]?.name || '사원');
    setNewEmpDuty(isComm ? '' : (u.jobTitle || '팀원'));
    setNewEmpPhone((u as any).phone || '');
    setNewEmpHireDate((u as any).hireDate || '');
    setNewEmpRrn((u as any).rrn || '');
    setNewEmpAddress((u as any).address || '');
    setNewEmpPersonalEmail((u as any).personalEmail || '');
    setNewEmpEmergencyPhone((u as any).emergencyPhone || '');
    setNewEmpEducation((u as any).education || '');
    setNewEmpIsAttendanceTarget(true);
  };

  // 정보 수정 폼 상태
  const [editModalTab, setEditModalTab] = useState<'work' | 'personal'>('work');
  const [editEmpName, setEditEmpName] = useState('');
  const [editEmpDept, setEditEmpDept] = useState('');
  const [editEmpPos, setEditEmpPos] = useState('');
  const [editEmpDuty, setEditEmpDuty] = useState('');
  const [editEmpEmail, setEditEmpEmail] = useState('');
  const [editEmpPhone, setEditEmpPhone] = useState('');
  const [editEmpHireDate, setEditEmpHireDate] = useState('');
  const [editEmpStatus, setEditEmpStatus] = useState<EmploymentStatus>('ACTIVE');
  const [editEmpIsAttendanceTarget, setEditEmpIsAttendanceTarget] = useState(true);
  const [editEmpRrn, setEditEmpRrn] = useState('');
  const [editEmpBirthDate, setEditEmpBirthDate] = useState('');
  const [editEmpGender, setEditEmpGender] = useState('');
  const [editEmpAddress, setEditEmpAddress] = useState('');
  const [editEmpPersonalEmail, setEditEmpPersonalEmail] = useState('');
  const [editEmpEmergencyPhone, setEditEmpEmergencyPhone] = useState('');
  const [editEmpEducation, setEditEmpEducation] = useState('');

  // 상세 보기 Drawer 내의 탭 상태 ('work': 인사/소속 | 'personal': 개인/신상)
  const [detailTab, setDetailTab] = useState<'work' | 'personal'>('work');
  const [showRrn, setShowRrn] = useState(false);

  // 조직도 노드 접힘 상태 관리
  const [collapsedDepts, setCollapsedDepts] = useState<Record<string, boolean>>({});

  // DB employeeProfiles 목록을 임직원 인터페이스로 어댑팅 (users 컬렉션과 매핑 및 폴백)
  const employees = useMemo(() => {
    const profileMap = new Map(employeeProfiles.map((p) => [p.userId || p.id, p]));

    return users.map((u) => {
      const p = profileMap.get(u.id);
      const isRetired = u.status === '미사용' || Boolean(u.resignedAt) || p?.status === 'RETIRED';
      const isPending = !isRetired && (!u.dept || u.dept === '미지정' || u.dept === '발령대기');
      const employmentStatus: EmploymentStatus = isRetired
        ? 'RETIRED'
        : p?.status || (u.status === '사용' ? 'ACTIVE' : u.status === '잠금' ? 'LEAVE' : 'RETIRED');

      // 근태 관리 대상 여부 판정 (프로필 설정값 반영, 기본값: true)
      const isAttendanceTarget = p?.isAttendanceTarget !== undefined ? Boolean(p.isAttendanceTarget) : true;

      return {
        id: p?.id || u.id,
        employeeNo: p?.empNo || u.empNo || u.id,
        name: p?.name || u.name,
        userId: u.id,
        dept: p?.dept || u.dept || '미지정',
        position: p?.position || u.position || '사원',
        duty: p?.jobTitle || u.jobTitle || '팀원',
        email: u.email || '',
        phone: p?.phone || (u as any).phone || '',
        profileImage: u.photoUrl || '',
        hireDate: p?.hireDate || (u as any).hireDate || '',
        employmentStatus,
        isPending,
        isAttendanceTarget,
        rrn: p?.rrn || (u as any).rrn || '',
        address: p?.address || (u as any).address || '',
        personalEmail: p?.personalEmail || (u as any).personalEmail || '',
        emergencyPhone: p?.emergencyPhone || (u as any).emergencyPhone || '',
        education: p?.education || (u as any).education || '',
        gender: p?.gender || (u as any).gender || '',
        birthDate: p?.birthDate || (u as any).birthDate || '',
      };
    });
  }, [employeeProfiles, users]);

  // 고유 소속 부서 목록 추출 (실제 부서 마스터 + 유저 부서)
  const allDepts = useMemo(() => {
    const set = new Set<string>();
    departments.forEach((d) => set.add(d.name));
    users.forEach((u) => {
      if (u.dept && u.dept !== '미지정') set.add(u.dept);
    });
    return Array.from(set);
  }, [departments, users]);

  // 고유 직급 목록 추출
  const allPositions = useMemo(() => {
    const set = new Set<string>();
    positions.forEach((p) => set.add(p.name));
    users.forEach((u) => {
      if (u.position) set.add(u.position);
    });
    return Array.from(set);
  }, [positions, users]);

  // 고유 직책 목록 추출
  const allJobTitles = useMemo(() => {
    const set = new Set<string>(['팀원', '파트장', '팀장', '본부장', '위원장']);
    jobTitles.forEach((j) => set.add(j.name));
    return Array.from(set);
  }, [jobTitles]);

  // 발령 대기 중인 계정 (부서 미지정 등)
  const unassignedUsers = useMemo(() => {
    return users.filter((u) => !u.dept || u.dept === '미지정');
  }, [users]);

  // 선택된 상세 사원 객체
  const selectedEmp = useMemo(() => {
    return employees.find((e) => e.id === selectedUserId || e.userId === selectedUserId) || null;
  }, [employees, selectedUserId]);

  // 선택된 사원의 부서 소속 목록 (본직 + 겸직)
  const selectedEmpMembers = useMemo(() => {
    if (!selectedEmp) return [];
    const list = departmentMembers.filter((m) => m.userId === selectedEmp.userId);
    if (list.length > 0) return list;
    return [
      {
        id: `fallback-${selectedEmp.userId}`,
        userId: selectedEmp.userId,
        deptId: 'dept-default',
        deptName: selectedEmp.dept,
        isPrimary: true,
        jobTitle: selectedEmp.duty,
        order: 1,
        assignedAt: '',
      },
    ];
  }, [departmentMembers, selectedEmp]);

  // 재직 상태별 카운트 계산
  const statusCounts = useMemo(() => {
    let total = employees.length;
    let active = 0;
    let retired = 0;
    let pending = 0;
    let leave = 0;

    for (const e of employees) {
      if (e.employmentStatus === 'RETIRED') retired++;
      else if (e.isPending) pending++;
      else if (e.employmentStatus === 'LEAVE') leave++;
      else active++;
    }

    return { total, active, retired, pending, leave };
  }, [employees]);

  // 근태관리 대상 여부별 카운트 계산
  const attendanceCounts = useMemo(() => {
    let target = 0;
    let excluded = 0;

    for (const e of employees) {
      if (e.isAttendanceTarget) target++;
      else excluded++;
    }

    return { total: employees.length, target, excluded };
  }, [employees]);

  // 필터링된 임직원 리스트
  const filteredEmployees = useMemo(() => {
    return employees.filter((e) => {
      const matchDept = deptFilter === 'all' || e.dept === deptFilter;
      const matchPos = posFilter === 'all' || e.position === posFilter;

      let matchStatus = true;
      if (statusFilter === 'ACTIVE') {
        matchStatus = e.employmentStatus === 'ACTIVE' && !e.isPending;
      } else if (statusFilter === 'RETIRED') {
        matchStatus = e.employmentStatus === 'RETIRED';
      } else if (statusFilter === 'PENDING') {
        matchStatus = Boolean(e.isPending);
      } else if (statusFilter === 'LEAVE') {
        matchStatus = e.employmentStatus === 'LEAVE';
      } else if (statusFilter === 'all') {
        matchStatus = true;
      }

      let matchAttendance = true;
      if (attendanceTargetFilter === 'target') {
        matchAttendance = Boolean(e.isAttendanceTarget);
      } else if (attendanceTargetFilter === 'excluded') {
        matchAttendance = !e.isAttendanceTarget;
      }

      const q = searchQuery.trim().toLowerCase();
      const matchQuery =
        !q ||
        e.name.toLowerCase().includes(q) ||
        e.employeeNo.toLowerCase().includes(q) ||
        (e.email && e.email.toLowerCase().includes(q)) ||
        (e.personalEmail && e.personalEmail.toLowerCase().includes(q));

      return matchDept && matchPos && matchStatus && matchAttendance && matchQuery;
    });
  }, [employees, deptFilter, posFilter, statusFilter, attendanceTargetFilter, searchQuery]);

  // 실시간 부서 트리 생성
  const orgTree: OrgNode[] = useMemo(() => {
    const deptMap = new Map<string, OrgNode>();
    departments.forEach((d) => {
      deptMap.set(d.id, {
        id: d.id,
        name: d.name,
        leaf: true,
        children: [],
      });
    });

    const roots: OrgNode[] = [];
    departments.forEach((d) => {
      const node = deptMap.get(d.id);
      if (!node) return;
      if (d.parentId && deptMap.has(d.parentId)) {
        const parent = deptMap.get(d.parentId)!;
        parent.leaf = false;
        parent.children?.push(node);
      } else {
        roots.push(node);
      }
    });

    return [
      {
        id: 'company_root',
        name: '워크핏 (전사)',
        leaf: false,
        children: roots.length > 0 ? roots : [{ id: 'default_dept', name: '본사', leaf: true }],
      },
    ];
  }, [departments]);

  const getActiveDeptEmployees = (deptName: string) => {
    return employees.filter((e) => e.dept === deptName && e.employmentStatus !== 'RETIRED');
  };

  const parseRrnInfo = (rrnVal: string) => {
    const cleaned = rrnVal.replace(/[^0-9]/g, '');
    if (cleaned.length < 7) return { gender: '', birthDate: '' };
    const birthPart = cleaned.substring(0, 6);
    const genderDigit = cleaned.charAt(6);

    let gender = '';
    if (['1', '3', '5'].includes(genderDigit)) gender = '남성';
    else if (['2', '4', '6'].includes(genderDigit)) gender = '여성';

    let yearPrefix = '19';
    if (['3', '4'].includes(genderDigit)) yearPrefix = '20';
    else if (['5', '6'].includes(genderDigit)) yearPrefix = '19';

    const birthDate = `${yearPrefix}${birthPart.substring(0, 2)}-${birthPart.substring(2, 4)}-${birthPart.substring(4, 6)}`;
    return { gender, birthDate };
  };

  // 1. 임직원 인사 발령 제출 (신규 employeeProfiles & departmentMembers 연동)
  const handleCreateEmployee = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCreateUserId) {
      alert('사용자 관리에서 등록된 계정을 먼저 선택해 주세요.');
      return;
    }

    const targetUser = users.find((u) => u.id === selectedCreateUserId);
    if (!targetUser) return;

    let gender = '';
    let birthDate = '';
    if (newEmpRrn) {
      const parsed = parseRrnInfo(newEmpRrn);
      gender = parsed.gender;
      birthDate = parsed.birthDate;
    }

    const targetDeptName = newEmpDept || departments[0]?.name || '인사지원팀';
    const targetDept = departments.find((d) => d.name === targetDeptName) || departments[0];
    const deptId = targetDept?.id || 'dept_default';
    const finalDuty = sanitizeJobTitle(targetDept, newEmpDuty || '팀원');

    try {
      await upsertEmployeeProfile.mutateAsync({
        id: targetUser.id,
        values: {
          userId: targetUser.id,
          empNo: targetUser.empNo,
          name: targetUser.name,
          dept: targetDeptName,
          position: newEmpPos || positions[0]?.name || '사원',
          jobTitle: finalDuty,
          status: 'ACTIVE',
          isAttendanceTarget: newEmpIsAttendanceTarget,
          phone: newEmpPhone.trim(),
          hireDate: newEmpHireDate,
          rrn: newEmpRrn.trim(),
          birthDate,
          gender,
          address: newEmpAddress.trim(),
          personalEmail: newEmpPersonalEmail.trim(),
          emergencyPhone: newEmpEmergencyPhone.trim(),
          education: newEmpEducation.trim(),
        },
      });

      // 주 소속(본직) departmentMember 생성
      await upsertDeptMember.mutateAsync({
        id: makeDepartmentMemberId(targetUser.id, deptId),
        userId: targetUser.id,
        deptId,
        deptName: targetDept?.name || targetDeptName,
        isPrimary: true,
        jobTitle: finalDuty,
        order: 1,
        assignedAt: new Date().toISOString(),
      });

      setSelectedCreateUserId('');
      setNewEmpNo('');
      setNewEmpName('');
      setNewEmpEmail('');
      setNewEmpPhone('');
      setNewEmpHireDate('');
      setNewEmpRrn('');
      setNewEmpAddress('');
      setNewEmpPersonalEmail('');
      setNewEmpEmergencyPhone('');
      setNewEmpEducation('');
      setNewEmpIsAttendanceTarget(true);
      setIsCreateModalOpen(false);
      alert('임직원 인사 발령이 성공적으로 완료되었습니다.');
    } catch (err: any) {
      alert(err.message || '인사 발령 처리 중 오류가 발생했습니다.');
    }
  };

  // 2. 임직원 정보 편집 모달 활성화 및 초기값 바인딩
  const openEditModal = (emp: typeof employees[0]) => {
    setEditModalTab('work');
    setEditEmpName(emp.name);
    setEditEmpDept(emp.dept);
    setEditEmpPos(emp.position);
    setEditEmpDuty(emp.duty);
    setEditEmpEmail(emp.email || '');
    setEditEmpPhone(emp.phone || '');
    setEditEmpHireDate(emp.hireDate || '');
    setEditEmpStatus(emp.employmentStatus);
    setEditEmpIsAttendanceTarget(emp.isAttendanceTarget);
    setEditEmpRrn(emp.rrn || '');
    setEditEmpBirthDate(emp.birthDate || '');
    setEditEmpGender(emp.gender || '');
    setEditEmpAddress(emp.address || '');
    setEditEmpPersonalEmail(emp.personalEmail || '');
    setEditEmpEmergencyPhone(emp.emergencyPhone || '');
    setEditEmpEducation(emp.education || '');
    setNewConcDeptId('');
    setNewConcJobTitle('팀원');
    setIsEditModalOpen(true);
  };

  // 3. 임직원 정보 편집 저장 제출 (신규 employeeProfiles & departmentMembers 연동)
  const handleUpdateEmployee = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedUserId || !editEmpName.trim()) return;

    const targetUser = users.find((u) => u.id === selectedUserId);
    if (!targetUser) return;

    let gender = editEmpGender;
    let birthDate = editEmpBirthDate;
    if (editEmpRrn && (!gender || !birthDate)) {
      const parsed = parseRrnInfo(editEmpRrn);
      if (parsed.gender) gender = parsed.gender;
      if (parsed.birthDate) birthDate = parsed.birthDate;
    }

    const targetDept = departments.find((d) => d.name === editEmpDept);
    const finalDuty = sanitizeJobTitle(targetDept || editEmpDept, editEmpDuty);

    try {
      await upsertEmployeeProfile.mutateAsync({
        id: targetUser.id,
        values: {
          userId: targetUser.id,
          empNo: targetUser.empNo,
          name: editEmpName.trim(),
          dept: editEmpDept || '미지정',
          position: editEmpPos || '사원',
          jobTitle: finalDuty,
          status: editEmpStatus,
          isAttendanceTarget: editEmpIsAttendanceTarget,
          phone: editEmpPhone.trim(),
          hireDate: editEmpHireDate,
          rrn: editEmpRrn.trim(),
          birthDate,
          gender,
          address: editEmpAddress.trim(),
          personalEmail: editEmpPersonalEmail.trim(),
          emergencyPhone: editEmpEmergencyPhone.trim(),
          education: editEmpEducation.trim(),
        },
      });

      // 주소속 부서가 변경된 경우 기존 주소속 레코드 갱신/대체
      if (targetDept) {
        const userMembers = departmentMembers.filter((m) => m.userId === targetUser.id);
        const prevPrimary = userMembers.find((m) => m.isPrimary);
        if (prevPrimary && prevPrimary.deptId !== targetDept.id) {
          await removeDeptMember.mutateAsync(prevPrimary.id);
        }
        await upsertDeptMember.mutateAsync({
          id: makeDepartmentMemberId(targetUser.id, targetDept.id),
          userId: targetUser.id,
          deptId: targetDept.id,
          deptName: targetDept.name,
          isPrimary: true,
          jobTitle: finalDuty,
          order: 1,
          assignedAt: prevPrimary?.assignedAt || new Date().toISOString(),
        });
      }

      setIsEditModalOpen(false);
      alert('임직원 인사 및 신상 정보가 성공적으로 반영되었습니다.');
    } catch (err: any) {
      alert(err.message || '수정 중 오류가 발생했습니다.');
    }
  };

  // 겸직 부서 추가 핸들러
  const handleAddConcurrentAffiliation = async () => {
    if (!selectedUserId || !newConcDeptId) return;
    const targetDept = departments.find((d) => d.id === newConcDeptId);
    if (!targetDept) return;

    // 이미 본직 또는 겸직으로 소속되어 있는지 검증
    const existing = departmentMembers.find(
      (m) => m.userId === selectedUserId && m.deptId === targetDept.id
    );
    if (existing) {
      alert('이미 소속되어 있는 부서입니다.');
      return;
    }

    const sanitizedDuty = sanitizeJobTitle(targetDept, newConcJobTitle);
    try {
      await upsertDeptMember.mutateAsync({
        id: makeDepartmentMemberId(selectedUserId, targetDept.id),
        userId: selectedUserId,
        deptId: targetDept.id,
        deptName: targetDept.name,
        isPrimary: false,
        jobTitle: sanitizedDuty,
        order: 99,
        assignedAt: new Date().toISOString(),
      });
      setNewConcDeptId('');
      setNewConcJobTitle('팀원');
      alert(`'${targetDept.name}' 겸직이 성공적으로 등록되었습니다.`);
    } catch (err: any) {
      alert(err.message || '겸직 등록 중 오류가 발생했습니다.');
    }
  };

  // 겸직 부서 해제 핸들러
  const handleRemoveConcurrentAffiliation = async (memberId: string, deptName: string) => {
    if (confirm(`'${deptName}' 겸직 소속을 해제하시겠습니까?`)) {
      try {
        await removeDeptMember.mutateAsync(memberId);
        alert(`'${deptName}' 겸직이 해제되었습니다.`);
      } catch (err: any) {
        alert(err.message || '겸직 해제 중 오류가 발생했습니다.');
      }
    }
  };

  // 4. 퇴직 처리
  const handleRetireEmployee = async (id: string) => {
    if (confirm('임직원 정보 보안 지침에 따라 계정을 퇴직(미사용) 상태로 즉시 변경 처리합니다. 진행하시겠습니까?')) {
      const targetUser = users.find((u) => u.id === id);
      if (!targetUser) return;

      await upsertEmployeeProfile.mutateAsync({
        id: targetUser.id,
        values: {
          status: 'RETIRED',
        },
      });
      alert('퇴직 처리가 완료되어 재직 목록 및 조직도 검색에서 제외됩니다.');
    }
  };

  const toggleDeptCollapse = (deptId: string) => {
    setCollapsedDepts((prev) => ({
      ...prev,
      [deptId]: !prev[deptId],
    }));
  };

  return (
    <div className="mx-auto w-full max-w-[1500px] px-4 py-5 sm:px-6 sm:py-6 text-[12px] text-ink">
      {/* ── 상단 헤더 영역 ── */}
      <GwHead
        icon="👥"
        name="인명관리"
        desc="임직원의 직급, 직책, 재직 현황 및 조직도 정보를 조회하고 관리합니다."
        right={
          isAdmin && activeTab === 'list' ? (
            <Button
              onClick={() => {
                setNewEmpDept(departments[0]?.name || '인사지원팀');
                setNewEmpPos(positions[0]?.name || '사원');
                setNewEmpDuty('팀원');
                setIsCreateModalOpen(true);
              }}
              variant="primary"
            >
              <Plus size={14} />
              <span>신규 임직원 등록</span>
            </Button>
          ) : undefined
        }
      />

      {/* ── 사이드바 + 메인 분할 레이아웃 ── */}
      <GwSplit
        nav={
          <GwSideNav
            title="인명관리"
            desc="임직원 및 조직도를 탐색합니다."
            items={[
              { id: 'list', icon: '👥', label: '임직원 관리' },
              { id: 'org', icon: '🏢', label: '회사 조직도' },
            ]}
            activeId={activeTab}
            onSelect={(id) => {
              setActiveTab(id as 'list' | 'org');
              setSelectedUserId(null);
            }}
          />
        }
      >
        {/* ── 메인 콘텐츠 영역 ── */}
        <main className="flex flex-1 flex-col gap-4 overflow-hidden rounded-xl border border-border bg-panel p-6 shadow-sm min-w-0">
        {/* ==================== A. 임직원 관리 탭 ==================== */}
        {activeTab === 'list' && (
          <div className="flex flex-1 flex-col gap-4 overflow-hidden">
            {/* 상단 타이틀 및 검색바 */}
            <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
              <div>
                <h1 className="text-[13.5px] font-extrabold text-ink">임직원 목록</h1>
                <p className="mt-0.5 text-[11px] text-ink3">사내 직원의 직급, 직책, 재직 현황 기준정보를 파악하고 검색합니다.</p>
              </div>

              <div className="flex items-center gap-2">
                <div className="relative">
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="이름, 사번, 이메일 검색"
                    className="h-8 w-56 rounded-lg border border-border bg-panel pl-3 pr-8 text-[11px] outline-none focus:border-teal placeholder:text-ink3"
                  />
                  <Search size={13} className="absolute right-2.5 top-2.5 text-ink3 pointer-events-none" />
                </div>
              </div>
            </div>

            {/* 필터 툴바 */}
            <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 rounded-lg border border-border/70 bg-panel-alt/30 p-2">
              <div className="flex flex-wrap items-center gap-3">
                {/* 재직 상태 필터 */}
                <div className="flex flex-wrap items-center gap-1.5">
                  {[
                    { key: 'all', label: '전체', count: statusCounts.total },
                    { key: 'ACTIVE', label: '재직', count: statusCounts.active },
                    { key: 'PENDING', label: '발령대기', count: statusCounts.pending },
                    { key: 'RETIRED', label: '퇴사자', count: statusCounts.retired },
                    { key: 'LEAVE', label: '휴직', count: statusCounts.leave },
                  ].map((st) => (
                    <button
                      key={st.key}
                      onClick={() => setStatusFilter(st.key)}
                      className={`flex items-center gap-1 rounded-md px-2.5 py-1 text-[11px] font-bold transition-all ${
                        statusFilter === st.key
                          ? 'bg-teal text-white shadow-2xs'
                          : 'border border-border/60 bg-panel text-ink2 hover:border-teal/50 hover:text-ink'
                      }`}
                    >
                      <span>{st.label}</span>
                      <span
                        className={`rounded-full px-1.5 py-0.2 text-[9.5px] ${
                          statusFilter === st.key ? 'bg-white/25 text-white' : 'bg-panel-alt text-ink3'
                        }`}
                      >
                        {st.count}
                      </span>
                    </button>
                  ))}
                </div>

                {/* 구분선 */}
                <div className="hidden sm:block h-4 w-px bg-border/80" />

                {/* 근태관리 대상 필터 버튼 그룹 */}
                <div className="flex items-center gap-1">
                  <span className="text-[11px] font-bold text-ink2 mr-0.5">근태관리:</span>
                  <button
                    type="button"
                    onClick={() => setAttendanceTargetFilter('all')}
                    className={`rounded-md px-2 py-1 text-[11px] font-bold transition-all ${
                      attendanceTargetFilter === 'all'
                        ? 'bg-slate-700 dark:bg-slate-300 text-white dark:text-slate-900 shadow-2xs'
                        : 'border border-border/60 bg-panel text-ink2 hover:border-border hover:text-ink'
                    }`}
                  >
                    전체
                  </button>
                  <button
                    type="button"
                    onClick={() => setAttendanceTargetFilter('target')}
                    className={`flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-bold transition-all ${
                      attendanceTargetFilter === 'target'
                        ? 'bg-emerald-600 text-white shadow-2xs'
                        : 'border border-border/60 bg-panel text-emerald-700 dark:text-emerald-400 hover:border-emerald-500/50'
                    }`}
                  >
                    <span>✓ 대상</span>
                    <span
                      className={`rounded-full px-1.5 py-0.2 text-[9.5px] ${
                        attendanceTargetFilter === 'target' ? 'bg-white/25 text-white' : 'bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300'
                      }`}
                    >
                      {attendanceCounts.target}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setAttendanceTargetFilter('excluded')}
                    className={`flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-bold transition-all ${
                      attendanceTargetFilter === 'excluded'
                        ? 'bg-rose-600 text-white shadow-2xs'
                        : 'border border-border/60 bg-panel text-rose-700 dark:text-rose-400 hover:border-rose-500/50'
                    }`}
                  >
                    <span>✕ 제외</span>
                    <span
                      className={`rounded-full px-1.5 py-0.2 text-[9.5px] ${
                        attendanceTargetFilter === 'excluded' ? 'bg-white/25 text-white' : 'bg-rose-100 dark:bg-rose-950 text-rose-700 dark:text-rose-300'
                      }`}
                    >
                      {attendanceCounts.excluded}
                    </span>
                  </button>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-1.5">
                  <span className="text-[11px] font-semibold text-ink3">소속 부서:</span>
                  <select
                    value={deptFilter}
                    onChange={(e) => setDeptFilter(e.target.value)}
                    className="h-7.5 rounded-lg border border-border bg-panel px-2 text-[11px] outline-none text-ink"
                  >
                    <option value="all">전체</option>
                    {allDepts.map((d) => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex items-center gap-1.5">
                  <span className="text-[11px] font-semibold text-ink3">직급:</span>
                  <select
                    value={posFilter}
                    onChange={(e) => setPosFilter(e.target.value)}
                    className="h-7.5 rounded-lg border border-border bg-panel px-2 text-[11px] outline-none text-ink"
                  >
                    <option value="all">전체</option>
                    {allPositions.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            {/* 임직원 목록 테이블 */}
            <div className="flex-1 overflow-auto rounded-lg border border-border bg-panel">
              <table className="w-full text-left border-collapse text-[11.5px]">
                <thead className="sticky top-0 z-10 border-b border-border bg-panel-alt/60 text-[11px] font-bold text-ink2 whitespace-nowrap">
                  <tr>
                    <th className="py-2.5 px-3 text-center w-12">사진</th>
                    <th className="py-2.5 px-3 w-28">사번</th>
                    <th className="py-2.5 px-3 w-28">이름</th>
                    <th className="py-2.5 px-3 min-w-[140px]">부서</th>
                    <th className="py-2.5 px-3 w-24">직급</th>
                    <th className="py-2.5 px-3 w-24">직책</th>
                    <th className="py-2.5 px-3 min-w-[220px]">이메일</th>
                    <th className="py-2.5 px-3 w-36">연락처</th>
                    <th className="py-2.5 px-3 text-center w-20">재직상태</th>
                    <th className="py-2.5 px-3 text-center w-24">근태관리</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredEmployees.length > 0 ? (
                    filteredEmployees.map((e) => {
                      const isSelected = e.id === selectedUserId;
                      return (
                        <tr
                          key={e.id}
                          onClick={() => setSelectedUserId(e.id)}
                          className={`cursor-pointer border-b border-border transition-colors hover:bg-panel-alt/30 ${
                            isSelected ? 'bg-teal-soft/10 font-semibold' : ''
                          }`}
                        >
                          <td className="py-2 px-3 text-center">
                            <span className="mx-auto grid h-6.5 w-6.5 place-items-center rounded-full bg-teal-soft text-[10.5px] font-bold text-teal">
                              {e.name[0]}
                            </span>
                          </td>
                          <td className="py-2 px-3 font-mono text-[11px] text-ink2">{e.employeeNo}</td>
                          <td className="py-2 px-3 font-bold text-[11.5px] text-ink">{e.name}</td>
                          <td className="py-2 px-3 text-[11.5px] text-ink2">
                            {e.isPending ? (
                              <span className="text-amber-600 font-medium text-[11px]">발령대기 (미지정)</span>
                            ) : (
                              <div className="flex items-center gap-1.5 whitespace-nowrap">
                                <span>{e.dept}</span>
                                {(() => {
                                  const concCount = departmentMembers.filter(
                                    (m) => m.userId === e.userId && !m.isPrimary
                                  ).length;
                                  if (concCount > 0) {
                                    return (
                                      <span className="rounded bg-slate-200 dark:bg-slate-700 px-1.5 py-0.2 text-[9.5px] font-bold text-slate-700 dark:text-slate-200 border border-slate-300 dark:border-slate-600">
                                        +{concCount}겸직
                                      </span>
                                    );
                                  }
                                  return null;
                                })()}
                              </div>
                            )}
                          </td>
                          <td className="py-2 px-3 text-[11.5px] text-ink2 whitespace-nowrap">{e.position}</td>
                          <td className="py-2 px-3 text-[11.5px] text-ink3 whitespace-nowrap">{e.duty}</td>
                          <td className="py-2 px-3 font-mono text-[11px] text-ink2 whitespace-nowrap">
                            {e.email && e.personalEmail && e.email !== e.personalEmail ? (
                              <div className="flex flex-col gap-0.5">
                                <div className="flex items-center gap-1" title={e.email}>
                                  <span className="shrink-0 rounded bg-teal-soft/40 px-1 font-sans text-[9px] font-bold text-teal">회사</span>
                                  <span className="whitespace-nowrap">{e.email}</span>
                                </div>
                                <div className="flex items-center gap-1" title={e.personalEmail}>
                                  <span className="shrink-0 rounded bg-panel-alt px-1 font-sans text-[9px] font-bold text-ink3">개인</span>
                                  <span className="whitespace-nowrap text-ink3">{e.personalEmail}</span>
                                </div>
                              </div>
                            ) : (
                              e.email || '-'
                            )}
                          </td>
                          <td className="py-2 px-3 font-mono text-[11px] text-ink3 whitespace-nowrap">{e.phone || '-'}</td>
                          <td className="py-2 px-3 text-center">
                            <span
                              className={`inline-block rounded border px-1.5 py-0.5 text-[9.5px] font-bold ${
                                e.employmentStatus === 'RETIRED'
                                  ? 'border-border bg-panel-alt text-ink3'
                                  : e.isPending
                                  ? 'border-indigo-500/30 bg-indigo-50 text-indigo-600'
                                  : e.employmentStatus === 'LEAVE'
                                  ? 'border-amber/20 bg-amber-soft text-amber'
                                  : 'border-teal/20 bg-teal-soft/20 text-teal'
                              }`}
                            >
                              {e.employmentStatus === 'RETIRED'
                                ? '퇴직'
                                : e.isPending
                                ? '발령대기'
                                : e.employmentStatus === 'LEAVE'
                                ? '휴직'
                                : '재직'}
                            </span>
                          </td>
                          <td className="py-2 px-3 text-center">
                            <span
                              className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[9.5px] font-bold ${
                                e.isAttendanceTarget
                                  ? 'border-emerald-500/30 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-400'
                                  : 'border-rose-500/30 bg-rose-50 text-rose-700 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-400'
                              }`}
                            >
                              {e.isAttendanceTarget ? '✓ 대상' : '✕ 제외'}
                            </span>
                          </td>
                        </tr>
                      );
                    })
                  ) : (
                    <tr>
                      <td colSpan={10} className="p-12 text-center text-ink3 text-[11.5px]">
                        {isUsersLoading ? '임직원 목록을 불러오는 중...' : '검색 조건에 일치하는 임직원이 없습니다.'}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ==================== B. 회사 조직도 탭 ==================== */}
        {activeTab === 'org' && (
          <div className="flex flex-1 flex-col gap-4 overflow-hidden">
            <div>
              <h1 className="text-[13.5px] font-extrabold text-ink">조직도 트리</h1>
              <p className="mt-0.5 text-[11px] text-ink3">회사 계층별 부서 트리와 소속 재직 직원 명단을 실시간으로 탐색합니다.</p>
            </div>

            <div className="grid flex-1 grid-cols-1 gap-5 overflow-hidden rounded-xl border border-border bg-panel p-4 md:grid-cols-[240px_1fr]">
              {/* 좌측 부서 트리 박스 */}
              <div className="space-y-3 overflow-y-auto border-r border-border pr-4">
                <h3 className="flex items-center gap-1 text-xs font-extrabold text-ink">
                  <span>🏢</span>
                  <span>부서 목록</span>
                </h3>

                <div className="space-y-1 pl-1 text-[12px] font-bold select-none">
                  {orgTree.map(function renderNode(node: OrgNode) {
                    const isCollapsed = collapsedDepts[node.id] || false;
                    const isLeaf = node.leaf || false;
                    const children = node.children || [];
                    const activeMembers = isLeaf ? getActiveDeptEmployees(node.name) : [];

                    return (
                      <div key={node.id} className="mt-0.5 flex flex-col">
                        <div
                          onClick={() => {
                            if (!isLeaf && children.length > 0) {
                              toggleDeptCollapse(node.id);
                            } else {
                              setSelectedDept(node.name);
                            }
                          }}
                          className={`flex cursor-pointer items-center gap-1.5 rounded-lg py-1.5 px-2 transition-colors ${
                            isLeaf
                              ? `hover:bg-teal-soft/10 text-ink ${selectedDept === node.name ? 'bg-teal-soft/15 font-extrabold text-teal' : ''}`
                              : 'text-ink2 hover:bg-black/5'
                          }`}
                        >
                          {!isLeaf && (
                            <span className="grid h-3 w-3 place-items-center text-[10px] text-ink3">
                              {isCollapsed ? '▶' : '▼'}
                            </span>
                          )}
                          <span>{isLeaf ? '📄' : '📁'}</span>
                          <span>{node.name}</span>
                          {isLeaf && (
                            <span className="ml-1 text-[10px] font-extrabold text-teal">
                              ({activeMembers.length})
                            </span>
                          )}
                        </div>

                        {!isCollapsed && children.length > 0 && (
                          <div className="my-0.5 ml-2.5 flex flex-col gap-0.5 border-l border-border/60 pl-4.5">
                            {children.map(renderNode)}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* 우측 소속 사원 리스트 박스 */}
              <div className="space-y-4 overflow-y-auto">
                <h3 className="flex items-center gap-1.5 border-b border-border pb-2.5 text-xs font-extrabold text-ink">
                  <span>👥</span>
                  <div className="flex items-center gap-1.5">
                    <span>부서 재직자 검색 명단 {selectedDept !== 'all' && `(${selectedDept})`}</span>
                  </div>
                  {selectedDept !== 'all' && (
                    <button
                      onClick={() => setSelectedDept('all')}
                      className="cursor-pointer border-none bg-transparent p-0 text-[10px] font-bold text-teal hover:underline"
                    >
                      전체 보기
                    </button>
                  )}
                </h3>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {employees
                    .filter((e) => e.employmentStatus !== 'RETIRED' && (selectedDept === 'all' || e.dept === selectedDept))
                    .map((emp) => (
                      <div
                        key={emp.id}
                        onClick={() => setSelectedUserId(emp.id)}
                        className="shadow-2xs flex cursor-pointer items-center gap-3.5 rounded-xl border border-border bg-panel p-3.5 transition-all hover:border-teal/30 hover:shadow-xs"
                      >
                        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-teal-soft text-[12px] font-bold text-teal">
                          {emp.name[0]}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[12px] font-bold text-ink">{emp.name}</div>
                          <div className="mt-0.5 flex items-center gap-1.5 truncate text-[10px] text-ink3">
                            <span>{emp.dept}</span>
                            <span>·</span>
                            <span>{emp.position}</span>
                          </div>
                        </div>
                      </div>
                    ))}
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
      </GwSplit>

      {/* ==================== C. 임직원 상세 모달 패널 ==================== */}
      {selectedUserId && selectedEmp && (
        <>
          <div
            onClick={() => setSelectedUserId(null)}
            className="fixed inset-0 z-40 bg-black/40 backdrop-blur-xs transition-opacity"
          />

          <div className="fixed inset-0 z-50 m-auto flex h-[560px] max-h-[calc(90vh/var(--font-scale,1))] w-[720px] max-w-[95vw] overflow-hidden rounded-3xl border border-border bg-panel shadow-2xl animate-in fade-in zoom-in-95 duration-200">
            {/* 좌측 프로필 카드 영역 */}
            <div className="flex w-[240px] shrink-0 flex-col items-center justify-between border-r border-border bg-gradient-to-b from-teal-soft/10 to-panel-alt/5 p-6 select-none">
              <div className="mt-4 flex w-full flex-col items-center">
                <div className="grid h-22 w-22 place-items-center rounded-full border-3 border-panel bg-teal text-3xl font-black text-white shadow-md">
                  {selectedEmp.name[0]}
                </div>

                <div className="mt-4 text-center text-base font-extrabold text-ink">
                  {selectedEmp.name}
                </div>
                <div className="mt-1.5 rounded border border-border bg-panel-alt px-2 py-0.5 font-mono text-[10px] font-bold text-ink2">
                  {selectedEmp.employeeNo}
                </div>

                <div className="mt-5 space-y-1 text-center">
                  <div className="text-xs font-bold text-teal">{selectedEmp.dept}</div>
                  <div className="text-[11px] font-semibold text-ink3">
                    {selectedEmp.position} {selectedEmp.duty && `· ${selectedEmp.duty}`}
                  </div>
                </div>
              </div>

              <div className="w-full rounded-xl border border-border/40 bg-panel-alt/20 py-2.5 px-3 text-center text-[10.5px] leading-relaxed text-ink3">
                소속 부서 및 보직 발령 완료
              </div>
            </div>

            {/* 우측 상세정보 탭 및 필드 영역 */}
            <div className="flex flex-1 flex-col justify-between overflow-hidden bg-panel">
              <div className="flex shrink-0 items-center justify-end border-b border-border bg-panel-alt/5 p-3.5">
                <button
                  onClick={() => setSelectedUserId(null)}
                  className="rounded p-1 text-ink3 hover:bg-panel-alt hover:text-ink transition-colors"
                >
                  <X size={16} />
                </button>
              </div>

              <div className="flex shrink-0 border-b border-border bg-panel-alt/5 text-[11.5px] font-bold">
                <button
                  type="button"
                  onClick={() => setDetailTab('work')}
                  className={`flex-1 py-2.5 text-center transition-colors border-b-2 ${
                    detailTab === 'work' ? 'border-teal text-teal' : 'border-transparent text-ink3 hover:text-ink'
                  }`}
                >
                  💼 인사 및 소속 정보
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setDetailTab('personal');
                    setShowRrn(false);
                  }}
                  className={`flex-1 py-2.5 text-center transition-colors border-b-2 ${
                    detailTab === 'personal' ? 'border-teal text-teal' : 'border-transparent text-ink3 hover:text-ink'
                  }`}
                >
                  🔒 개인 신상 정보 (인사팀용)
                </button>
              </div>

              <div className="flex-1 space-y-4 overflow-y-auto p-6 text-[12px]">
                {detailTab === 'work' && (
                  <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-y-4 gap-x-3.5">
                      <div>
                        <span className="block text-[11px] text-ink3">재직 상태</span>
                        <span
                          className={`mt-1 inline-block rounded border px-1.5 py-0.5 text-[10px] font-bold ${
                            selectedEmp.employmentStatus === 'ACTIVE'
                              ? 'border-teal/20 bg-teal-soft/20 text-teal'
                              : selectedEmp.employmentStatus === 'LEAVE'
                              ? 'border-amber/20 bg-amber-soft text-amber'
                              : 'border-border bg-panel-alt text-ink3'
                          }`}
                        >
                          {selectedEmp.employmentStatus === 'ACTIVE' ? '재직 중' : selectedEmp.employmentStatus === 'LEAVE' ? '휴직' : '퇴직자'}
                        </span>
                      </div>

                      <div>
                        <span className="block text-[11px] text-ink3">근태 관리</span>
                        <span
                          className={`mt-1 inline-block rounded border px-1.5 py-0.5 text-[10px] font-bold ${
                            selectedEmp.isAttendanceTarget
                              ? 'border-teal/20 bg-teal-soft/20 text-teal'
                              : 'border-slate-300 bg-slate-100 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300'
                          }`}
                        >
                          {selectedEmp.isAttendanceTarget ? '대상 (ON)' : '제외 (OFF)'}
                        </span>
                      </div>

                      <div>
                        <span className="block text-[11px] text-ink3">입사일</span>
                        <span className="mt-1 block font-mono font-semibold text-ink">{selectedEmp.hireDate || '-'}</span>
                      </div>

                      <div>
                        <span className="block text-[11px] text-ink3">사번 (ID)</span>
                        <span className="mt-1 block font-mono font-semibold text-ink">{selectedEmp.employeeNo}</span>
                      </div>

                      <div>
                        <span className="block text-[11px] text-ink3">소속 부서</span>
                        <span className="mt-1 block font-semibold text-ink">{selectedEmp.dept}</span>
                      </div>

                      <div>
                        <span className="block text-[11px] text-ink3">직급 / 직책</span>
                        <span className="mt-1 block font-semibold text-ink">
                          {selectedEmp.position} {selectedEmp.duty && `(${selectedEmp.duty})`}
                        </span>
                      </div>

                      <div>
                        <span className="block text-[11px] text-ink3">업무 이메일</span>
                        <span className="mt-1 block break-all font-mono font-semibold text-ink">{selectedEmp.email || '-'}</span>
                      </div>

                      <div className="col-span-2">
                        <span className="block text-[11px] text-ink3">업무 연락처</span>
                        <span className="mt-1 block font-mono font-semibold text-ink">{selectedEmp.phone || '-'}</span>
                      </div>
                    </div>

                    {/* 소속 및 겸직 현황 섹션 */}
                    <div className="mt-2 rounded-xl border border-border/80 bg-panel-alt/25 p-3.5">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-[11.5px] font-extrabold text-ink flex items-center gap-1.5">
                          <span>🏢</span> 소속 및 겸직 현황
                          <span className="rounded-full bg-teal-soft/60 px-1.5 py-0.2 text-[10px] font-bold text-teal">
                            총 {selectedEmpMembers.length}개 소속
                          </span>
                        </span>
                      </div>
                      <div className="space-y-1.5">
                        {selectedEmpMembers.map((m) => {
                          const deptObj = departments.find((d) => d.id === m.deptId || d.name === m.deptName);
                          const isComm = isCommitteeDept(deptObj || m.deptName);
                          return (
                            <div
                              key={m.id}
                              className="flex items-center justify-between rounded-lg border border-border bg-panel px-3 py-2 text-[11.5px]"
                            >
                              <div className="flex items-center gap-2">
                                <span
                                  className={`rounded px-1.5 py-0.5 text-[9.5px] font-bold ${
                                    m.isPrimary
                                      ? 'bg-teal-soft text-teal border border-teal/20'
                                      : 'bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200 border border-slate-300 dark:border-slate-600'
                                  }`}
                                >
                                  {m.isPrimary ? '주소속' : '겸직'}
                                </span>
                                <span className="font-bold text-ink">{m.deptName}</span>
                              </div>
                              <div className="flex items-center gap-1.5">
                                {isComm ? (
                                  <span className="rounded bg-panel-alt px-2 py-0.5 text-[10px] font-medium text-ink3 border border-border">
                                    직책 없음 (위원회)
                                  </span>
                                ) : m.jobTitle ? (
                                  <span className="rounded bg-teal-soft/20 px-2 py-0.5 text-[10.5px] font-bold text-teal border border-teal/20">
                                    {m.jobTitle}
                                  </span>
                                ) : (
                                  <span className="text-[10.5px] text-ink3">팀원</span>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                )}

                {detailTab === 'personal' && (
                  <div className="space-y-4">
                    <div className="rounded-xl border border-amber-500/10 bg-amber-500/5 p-3 text-[10.5px] font-bold leading-relaxed text-amber-800">
                      🔒 본 정보는 개인 신상정보를 포함하고 있으므로 열람 및 취급에 주의를 요합니다. (인사관리 전용)
                    </div>

                    <div className="grid grid-cols-2 gap-y-4 gap-x-3.5">
                      <div>
                        <span className="block text-[11px] text-ink3">생년월일</span>
                        <span className="mt-1 block font-mono font-semibold text-ink">{selectedEmp.birthDate || '-'}</span>
                      </div>

                      <div>
                        <span className="block text-[11px] text-ink3">성별</span>
                        <span className="mt-1 block font-semibold text-ink">{selectedEmp.gender || '-'}</span>
                      </div>

                      <div className="col-span-2">
                        <span className="block text-[11px] text-ink3">주민등록번호</span>
                        <div className="mt-1 flex items-center gap-2">
                          <span className="font-mono font-semibold tracking-wider text-ink">
                            {showRrn
                              ? selectedEmp.rrn || '-'
                              : selectedEmp.rrn
                              ? `${selectedEmp.rrn.split('-')[0]}-${selectedEmp.rrn.split('-')[1]?.charAt(0) || ''}******`
                              : '-'}
                          </span>
                          {selectedEmp.rrn && (
                            <button
                              type="button"
                              onClick={() => setShowRrn(!showRrn)}
                              className="cursor-pointer border-none bg-transparent p-0 text-[10px] font-bold text-teal hover:underline"
                            >
                              {showRrn ? '🙈 숨기기' : '👁️ 전체보기'}
                            </button>
                          )}
                        </div>
                      </div>

                      <div className="col-span-2">
                        <span className="block text-[11px] text-ink3">주소</span>
                        <span className="mt-1 block leading-relaxed font-semibold text-ink">{selectedEmp.address || '-'}</span>
                      </div>

                      <div>
                        <span className="block text-[11px] text-ink3">개인 이메일</span>
                        <span className="mt-1 block break-all font-mono font-semibold text-ink">{selectedEmp.personalEmail || '-'}</span>
                      </div>

                      <div>
                        <span className="block text-[11px] text-ink3">비상 연락처</span>
                        <span className="mt-1 block font-mono font-semibold text-ink">{selectedEmp.emergencyPhone || '-'}</span>
                      </div>

                      <div className="col-span-2">
                        <span className="block text-[11px] text-ink3">최종 학력</span>
                        <span className="mt-1 block font-semibold text-ink">{selectedEmp.education || '-'}</span>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {isAdmin && selectedEmp.employmentStatus !== 'RETIRED' && (
                <div className="flex shrink-0 gap-2 border-t border-border bg-panel-alt/10 p-4">
                  <button
                    type="button"
                    onClick={() => openEditModal(selectedEmp)}
                    className="flex-1 rounded-lg bg-teal py-2 text-[11.5px] font-bold text-white transition-opacity hover:opacity-90"
                  >
                    ⚙️ 인사 발령 / 개인신상 수정
                  </button>
                  <button
                    type="button"
                    onClick={() => handleRetireEmployee(selectedEmp.id)}
                    className="flex-1 rounded-lg border border-red/20 bg-red-soft/10 py-2 text-[11.5px] font-bold text-red transition-colors hover:bg-red-soft/20 flex items-center justify-center gap-1"
                  >
                    <AlertTriangle size={13} />
                    <span>퇴직 처리</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {/* ==================== D. 관리자 전용 신규 임직원 등록 모달 (사용자 관리 계정 연동) ==================== */}
      {isCreateModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="flex max-h-[calc(90vh/var(--font-scale,1))] w-[480px] flex-col gap-4 overflow-y-auto rounded-xl border border-border bg-panel p-5 shadow-2xl">
            <div className="flex shrink-0 items-center justify-between border-b border-border pb-2">
              <span className="text-[13px] font-extrabold text-navy">👤 임직원 인사 발령 (등록)</span>
              <button onClick={() => setIsCreateModalOpen(false)} className="text-ink3 hover:text-ink p-1">
                <X size={15} />
              </button>
            </div>

            <form onSubmit={handleCreateEmployee} className="space-y-3.5">
              {/* 계정 선택 필드 */}
              <div className="flex flex-col gap-1.5 rounded-lg border border-teal/30 bg-teal-soft/10 p-3">
                <label className="text-[11.5px] font-extrabold text-teal">
                  1. 발령 대상 계정 선택 (사용자 관리 등록 계정) <span className="text-red">*</span>
                </label>
                <select
                  value={selectedCreateUserId}
                  onChange={(e) => handleSelectCreateUser(e.target.value)}
                  required
                  className="h-9 w-full rounded-lg border border-border bg-panel px-3 text-[12px] font-semibold text-ink outline-none focus:border-teal"
                >
                  <option value="">
                    {unassignedUsers.length > 0
                      ? '발령 대기 계정을 선택하세요'
                      : '현재 발령 대기 중인 신규 계정이 없습니다 (전원 발령 완료)'}
                  </option>
                  {unassignedUsers.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name} ({u.empNo}) - 발령 대기
                    </option>
                  ))}
                </select>
                {unassignedUsers.length === 0 ? (
                  <span className="text-[10.5px] font-semibold text-teal">
                    ✨ 모든 계정이 이미 부서 발령을 마쳤습니다. 신규 직원은 <strong>[사용자 관리]</strong>에서 먼저 계정을 추가해 주세요.
                  </span>
                ) : (
                  <span className="text-[10.5px] text-ink3">
                    💡 <strong>[사용자 관리]</strong>에서 생성된 후 아직 부서가 지정되지 않은 계정만 표시됩니다.
                  </span>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1.5">
                  <label className="font-bold text-ink2">사번 (계정 연동)</label>
                  <input
                    type="text"
                    value={newEmpNo}
                    disabled
                    placeholder="계정 선택 시 자동 입력"
                    className="h-9 w-full rounded-lg border border-border bg-panel-alt/50 px-3 font-mono text-[12px] text-ink3 outline-none"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="font-bold text-ink2">이름 (계정 연동)</label>
                  <input
                    type="text"
                    value={newEmpName}
                    disabled
                    placeholder="계정 선택 시 자동 입력"
                    className="h-9 w-full rounded-lg border border-border bg-panel-alt/50 px-3 text-[12px] font-bold text-ink3 outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div className="flex flex-col gap-1.5">
                  <label className="font-bold text-ink2">소속 부서 (발령)</label>
                  <select
                    value={newEmpDept}
                    onChange={(e) => {
                      const val = e.target.value;
                      setNewEmpDept(val);
                      const dObj = departments.find((d) => d.name === val);
                      if (isCommitteeDept(dObj || val)) {
                        setNewEmpDuty('');
                      } else if (!newEmpDuty) {
                        setNewEmpDuty('팀원');
                      }
                    }}
                    className="h-9.5 rounded-lg border border-border bg-panel px-2 text-[12px] outline-none focus:border-teal"
                  >
                    {allDepts.map((d) => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="font-bold text-ink2">직급</label>
                  <select
                    value={newEmpPos}
                    onChange={(e) => setNewEmpPos(e.target.value)}
                    className="h-9.5 rounded-lg border border-border bg-panel px-2 text-[12px] outline-none focus:border-teal"
                  >
                    {allPositions.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="font-bold text-ink2">직책</label>
                  {(() => {
                    const isComm = isCommitteeDept(departments.find((d) => d.name === newEmpDept) || newEmpDept);
                    return (
                      <select
                        value={isComm ? '' : newEmpDuty}
                        disabled={isComm}
                        onChange={(e) => setNewEmpDuty(e.target.value)}
                        className="h-9.5 rounded-lg border border-border bg-panel px-2 text-[12px] outline-none focus:border-teal disabled:bg-panel-alt/50 disabled:text-ink3"
                      >
                        {isComm ? (
                          <option value="">직책 없음 (위원회)</option>
                        ) : (
                          allJobTitles.map((j) => (
                            <option key={j} value={j}>
                              {j}
                            </option>
                          ))
                        )}
                      </select>
                    );
                  })()}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1.5">
                  <label className="font-bold text-ink2">업무 이메일</label>
                  <input
                    type="email"
                    value={newEmpEmail}
                    onChange={(e) => setNewEmpEmail(e.target.value)}
                    placeholder="name@workfit.co.kr"
                    className="h-9 w-full rounded-lg border border-border bg-panel px-3 font-mono text-[12px] outline-none focus:border-teal"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="font-bold text-ink2">업무 연락처</label>
                  <input
                    type="text"
                    value={newEmpPhone}
                    onChange={(e) => setNewEmpPhone(e.target.value)}
                    placeholder="010-0000-0000"
                    className="h-9 w-full rounded-lg border border-border bg-panel px-3 font-mono text-[12px] outline-none focus:border-teal"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1.5">
                  <label className="font-bold text-ink2">입사일</label>
                  <input
                    type="date"
                    value={newEmpHireDate}
                    onChange={(e) => setNewEmpHireDate(e.target.value)}
                    className="h-9 w-full rounded-lg border border-border bg-panel px-3 text-[12px] outline-none focus:border-teal"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="font-bold text-ink2">주민등록번호</label>
                  <input
                    type="text"
                    value={newEmpRrn}
                    onChange={(e) => setNewEmpRrn(e.target.value)}
                    placeholder="900101-1234567"
                    className="h-9 w-full rounded-lg border border-border bg-panel px-3 font-mono text-[12px] outline-none focus:border-teal"
                  />
                </div>
              </div>

              {/* 근태 관리 대상 여부 설정 */}
              <div className="flex items-center justify-between rounded-lg border border-border bg-panel-alt/30 p-2.5">
                <div>
                  <span className="text-[11.5px] font-bold text-ink">근태 관리 대상</span>
                  <p className="text-[10px] text-ink3">
                    OFF 시 전사 근태/휴가 관리 및 연차 원장에서 제외됩니다 (비상근·대표이사 등).
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setNewEmpIsAttendanceTarget(!newEmpIsAttendanceTarget)}
                  className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px] font-extrabold transition-all cursor-pointer ${
                    newEmpIsAttendanceTarget
                      ? 'border-teal bg-teal text-white shadow-xs'
                      : 'border-slate-300 bg-slate-100 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300'
                  }`}
                >
                  <span>{newEmpIsAttendanceTarget ? '✓ 대상 (ON)' : '✕ 제외 (OFF)'}</span>
                </button>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1.5">
                  <label className="font-bold text-ink2">개인 이메일</label>
                  <input
                    type="email"
                    value={newEmpPersonalEmail}
                    onChange={(e) => setNewEmpPersonalEmail(e.target.value)}
                    placeholder="personal@email.com"
                    className="h-9 w-full rounded-lg border border-border bg-panel px-3 font-mono text-[12px] outline-none focus:border-teal"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="font-bold text-ink2">비상 연락처</label>
                  <input
                    type="text"
                    value={newEmpEmergencyPhone}
                    onChange={(e) => setNewEmpEmergencyPhone(e.target.value)}
                    placeholder="010-9999-8888"
                    className="h-9 w-full rounded-lg border border-border bg-panel px-3 font-mono text-[12px] outline-none focus:border-teal"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1.5">
                  <label className="font-bold text-ink2">주소</label>
                  <input
                    type="text"
                    value={newEmpAddress}
                    onChange={(e) => setNewEmpAddress(e.target.value)}
                    placeholder="자택 주소 입력"
                    className="h-9 w-full rounded-lg border border-border bg-panel px-3 text-[12px] outline-none focus:border-teal"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="font-bold text-ink2">최종 학력</label>
                  <input
                    type="text"
                    value={newEmpEducation}
                    onChange={(e) => setNewEmpEducation(e.target.value)}
                    placeholder="예: 대학교 학사"
                    className="h-9 w-full rounded-lg border border-border bg-panel px-3 text-[12px] outline-none focus:border-teal"
                  />
                </div>
              </div>

              <div className="flex shrink-0 justify-end gap-2 border-t border-border/40 pt-3">
                <button
                  type="button"
                  onClick={() => setIsCreateModalOpen(false)}
                  className="rounded-lg border px-4 py-2 font-bold text-ink2 hover:bg-panel-alt"
                >
                  취소
                </button>
                <button
                  type="submit"
                  className="rounded-lg bg-teal px-5 py-2 font-bold text-white hover:opacity-90"
                >
                  등록 완료
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ==================== E. 관리자 전용 임직원 정보 편집 모달 (인사/신상 탭) ==================== */}
      {isEditModalOpen && selectedEmp && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="flex max-h-[calc(90vh/var(--font-scale,1))] w-[480px] flex-col gap-4 overflow-y-auto rounded-xl border border-border bg-panel p-5 shadow-2xl">
            <div className="flex shrink-0 items-center justify-between border-b border-border pb-2">
              <span className="text-[13px] font-extrabold text-navy">⚙️ {selectedEmp.name} 인사 및 신상 정보 수정</span>
              <button onClick={() => setIsEditModalOpen(false)} className="text-ink3 hover:text-ink p-1">
                <X size={15} />
              </button>
            </div>

            {/* 편집 모달 서브 탭 */}
            <div className="flex border-b border-border text-[11.5px] font-bold">
              <button
                type="button"
                onClick={() => setEditModalTab('work')}
                className={`flex-1 py-2 text-center transition-colors border-b-2 ${
                  editModalTab === 'work' ? 'border-teal text-teal' : 'border-transparent text-ink3 hover:text-ink'
                }`}
              >
                💼 인사 및 소속 정보
              </button>
              <button
                type="button"
                onClick={() => setEditModalTab('personal')}
                className={`flex-1 py-2 text-center transition-colors border-b-2 ${
                  editModalTab === 'personal' ? 'border-teal text-teal' : 'border-transparent text-ink3 hover:text-ink'
                }`}
              >
                🔒 개인 신상 정보
              </button>
            </div>

            <form onSubmit={handleUpdateEmployee} className="space-y-4">
              {editModalTab === 'work' && (
                <div className="space-y-3.5">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="flex flex-col gap-1.5">
                      <label className="font-bold text-ink2">사번 (수정 불가)</label>
                      <input
                        type="text"
                        value={selectedEmp.employeeNo}
                        disabled
                        className="h-9 w-full rounded-lg border border-border bg-panel-alt/50 px-3 font-mono text-[12px] text-ink3 outline-none"
                      />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <label className="font-bold text-ink2">이름 (필수)</label>
                      <input
                        type="text"
                        value={editEmpName}
                        onChange={(e) => setEditEmpName(e.target.value)}
                        required
                        className="h-9 w-full rounded-lg border border-border bg-panel px-3 text-[12px] outline-none focus:border-teal"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-2">
                    <div className="flex flex-col gap-1.5">
                      <label className="font-bold text-ink2">소속 부서 (본직)</label>
                      <select
                        value={editEmpDept}
                        onChange={(e) => {
                          const val = e.target.value;
                          setEditEmpDept(val);
                          const dObj = departments.find((d) => d.name === val);
                          if (isCommitteeDept(dObj || val)) {
                            setEditEmpDuty('');
                          } else if (!editEmpDuty) {
                            setEditEmpDuty('팀원');
                          }
                        }}
                        className="h-9.5 rounded-lg border border-border bg-panel px-2 text-[12px] outline-none focus:border-teal"
                      >
                        {allDepts.map((d) => (
                          <option key={d} value={d}>
                            {d}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="flex flex-col gap-1.5">
                      <label className="font-bold text-ink2">직급</label>
                      <select
                        value={editEmpPos}
                        onChange={(e) => setEditEmpPos(e.target.value)}
                        className="h-9.5 rounded-lg border border-border bg-panel px-2 text-[12px] outline-none focus:border-teal"
                      >
                        {allPositions.map((p) => (
                          <option key={p} value={p}>
                            {p}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="flex flex-col gap-1.5">
                      <label className="font-bold text-ink2">직책</label>
                      {(() => {
                        const isComm = isCommitteeDept(departments.find((d) => d.name === editEmpDept) || editEmpDept);
                        return (
                          <select
                            value={isComm ? '' : editEmpDuty}
                            disabled={isComm}
                            onChange={(e) => setEditEmpDuty(e.target.value)}
                            className="h-9.5 rounded-lg border border-border bg-panel px-2 text-[12px] outline-none focus:border-teal disabled:bg-panel-alt/50 disabled:text-ink3"
                          >
                            {isComm ? (
                              <option value="">직책 없음 (위원회)</option>
                            ) : (
                              allJobTitles.map((j) => (
                                <option key={j} value={j}>
                                  {j}
                                </option>
                              ))
                            )}
                          </select>
                        );
                      })()}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="flex flex-col gap-1.5">
                      <label className="font-bold text-ink2">재직 상태</label>
                      <select
                        value={editEmpStatus}
                        onChange={(e) => setEditEmpStatus(e.target.value as EmploymentStatus)}
                        className="h-9.5 rounded-lg border border-border bg-panel px-2 text-[12px] outline-none focus:border-teal"
                      >
                        <option value="ACTIVE">재직</option>
                        <option value="LEAVE">휴직</option>
                        <option value="RETIRED">퇴직</option>
                      </select>
                    </div>

                    <div className="flex flex-col gap-1.5">
                      <label className="font-bold text-ink2">입사일</label>
                      <input
                        type="date"
                        value={editEmpHireDate}
                        onChange={(e) => setEditEmpHireDate(e.target.value)}
                        className="h-9 w-full rounded-lg border border-border bg-panel px-3 text-[12px] outline-none focus:border-teal"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="flex flex-col gap-1.5">
                      <label className="font-bold text-ink2">업무 이메일</label>
                      <input
                        type="email"
                        value={editEmpEmail}
                        onChange={(e) => setEditEmpEmail(e.target.value)}
                        className="h-9 w-full rounded-lg border border-border bg-panel px-3 font-mono text-[12px] outline-none focus:border-teal"
                      />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <label className="font-bold text-ink2">업무 연락처</label>
                      <input
                        type="text"
                        value={editEmpPhone}
                        onChange={(e) => setEditEmpPhone(e.target.value)}
                        className="h-9 w-full rounded-lg border border-border bg-panel px-3 font-mono text-[12px] outline-none focus:border-teal"
                      />
                    </div>
                  </div>

                  {/* 근태 관리 대상 여부 설정 */}
                  <div className="flex items-center justify-between rounded-lg border border-border bg-panel-alt/30 p-2.5">
                    <div>
                      <span className="text-[11.5px] font-bold text-ink">근태 관리 대상</span>
                      <p className="text-[10px] text-ink3">
                        OFF 시 전사 근태/휴가 관리 및 연차 원장에서 제외됩니다 (비상근·대표이사 등).
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setEditEmpIsAttendanceTarget(!editEmpIsAttendanceTarget)}
                      className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px] font-extrabold transition-all cursor-pointer ${
                        editEmpIsAttendanceTarget
                          ? 'border-teal bg-teal text-white shadow-xs'
                          : 'border-slate-300 bg-slate-100 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300'
                      }`}
                    >
                      <span>{editEmpIsAttendanceTarget ? '✓ 대상 (ON)' : '✕ 제외 (OFF)'}</span>
                    </button>
                  </div>

                  {/* 겸직 부서 관리 섹션 */}
                  <div className="rounded-xl border border-border bg-panel-alt/25 p-3.5 space-y-3">
                    <div className="flex items-center justify-between">
                      <label className="text-[11.5px] font-extrabold text-ink flex items-center gap-1">
                        <span>🔀</span> 겸직 부서 관리
                      </label>
                      <span className="text-[10px] text-ink3">
                        본직 외 추가로 소속될 부서와 직책을 지정합니다.
                      </span>
                    </div>

                    {/* 현재 지정된 겸직 목록 */}
                    <div className="space-y-1.5">
                      {departmentMembers
                        .filter((m) => m.userId === selectedEmp.userId && !m.isPrimary)
                        .map((m) => {
                          const deptObj = departments.find((d) => d.id === m.deptId || d.name === m.deptName);
                          const isComm = isCommitteeDept(deptObj || m.deptName);
                          return (
                            <div
                              key={m.id}
                              className="flex items-center justify-between rounded-lg border border-border bg-panel px-3 py-1.5 text-[11px]"
                            >
                              <div className="flex items-center gap-2">
                                <span className="rounded bg-slate-200 dark:bg-slate-700 px-1.5 py-0.5 text-[9.5px] font-bold text-slate-700 dark:text-slate-200 border border-slate-300 dark:border-slate-600">
                                  겸직
                                </span>
                                <span className="font-semibold text-ink">{m.deptName}</span>
                                <span className="text-ink3 font-medium">
                                  {isComm ? '(위원회 · 직책 없음)' : `[${m.jobTitle || '팀원'}]`}
                                </span>
                              </div>
                              <button
                                type="button"
                                onClick={() => handleRemoveConcurrentAffiliation(m.id, m.deptName)}
                                className="text-red hover:underline text-[10.5px] font-bold cursor-pointer"
                              >
                                해제
                              </button>
                            </div>
                          );
                        })}
                      {departmentMembers.filter((m) => m.userId === selectedEmp.userId && !m.isPrimary).length === 0 && (
                        <div className="py-2 text-center text-[10.5px] text-ink3">
                          지정된 겸직 부서가 없습니다.
                        </div>
                      )}
                    </div>

                    {/* 신규 겸직 추가 폼 */}
                    <div className="border-t border-border/60 pt-2.5 space-y-2">
                      <div className="text-[10.5px] font-bold text-ink2">+ 새로운 겸직 부서 추가</div>
                      <div className="flex items-center gap-2">
                        <select
                          value={newConcDeptId}
                          onChange={(e) => {
                            const val = e.target.value;
                            setNewConcDeptId(val);
                            const dept = departments.find((d) => d.id === val);
                            if (isCommitteeDept(dept)) {
                              setNewConcJobTitle('');
                            } else if (!newConcJobTitle) {
                              setNewConcJobTitle('팀원');
                            }
                          }}
                          className="h-8 flex-1 rounded-lg border border-border bg-panel px-2 text-[11px] outline-none focus:border-teal"
                        >
                          <option value="">부서 선택...</option>
                          {departments
                            .filter(
                              (d) =>
                                d.name !== editEmpDept &&
                                !departmentMembers.some((m) => m.userId === selectedEmp.userId && (m.deptId === d.id || m.deptName === d.name))
                            )
                            .map((d) => (
                              <option key={d.id} value={d.id}>
                                {d.name} {isCommitteeDept(d) ? '(위원회)' : ''}
                              </option>
                            ))}
                        </select>

                        {/* 직책 선택: 위원회 부서 선택 시 비활성화 & '직책 없음' 표시 */}
                        {(() => {
                          const selectedDeptObj = departments.find((d) => d.id === newConcDeptId);
                          const isComm = isCommitteeDept(selectedDeptObj);
                          return (
                            <select
                              value={isComm ? '' : newConcJobTitle}
                              disabled={!newConcDeptId || isComm}
                              onChange={(e) => setNewConcJobTitle(e.target.value)}
                              className="h-8 w-28 rounded-lg border border-border bg-panel px-2 text-[11px] outline-none focus:border-teal disabled:bg-panel-alt/50 disabled:text-ink3"
                            >
                              {isComm ? (
                                <option value="">직책 없음</option>
                              ) : (
                                allJobTitles.map((j) => (
                                  <option key={j} value={j}>
                                    {j}
                                  </option>
                                ))
                              )}
                            </select>
                          );
                        })()}

                        <button
                          type="button"
                          onClick={handleAddConcurrentAffiliation}
                          disabled={!newConcDeptId}
                          className="h-8 rounded-lg bg-teal px-3 text-[11px] font-bold text-white transition-opacity hover:opacity-90 disabled:opacity-40 cursor-pointer"
                        >
                          추가
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {editModalTab === 'personal' && (
                <div className="space-y-3.5">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="flex flex-col gap-1.5">
                      <label className="font-bold text-ink2">주민등록번호</label>
                      <input
                        type="text"
                        value={editEmpRrn}
                        onChange={(e) => {
                          setEditEmpRrn(e.target.value);
                          const parsed = parseRrnInfo(e.target.value);
                          if (parsed.gender) setEditEmpGender(parsed.gender);
                          if (parsed.birthDate) setEditEmpBirthDate(parsed.birthDate);
                        }}
                        placeholder="900101-1234567"
                        className="h-9 w-full rounded-lg border border-border bg-panel px-3 font-mono text-[12px] outline-none focus:border-teal"
                      />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <label className="font-bold text-ink2">생년월일</label>
                      <input
                        type="date"
                        value={editEmpBirthDate}
                        onChange={(e) => setEditEmpBirthDate(e.target.value)}
                        className="h-9 w-full rounded-lg border border-border bg-panel px-3 text-[12px] outline-none focus:border-teal"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="flex flex-col gap-1.5">
                      <label className="font-bold text-ink2">성별</label>
                      <select
                        value={editEmpGender}
                        onChange={(e) => setEditEmpGender(e.target.value)}
                        className="h-9.5 rounded-lg border border-border bg-panel px-2 text-[12px] outline-none focus:border-teal"
                      >
                        <option value="">선택</option>
                        <option value="남성">남성</option>
                        <option value="여성">여성</option>
                      </select>
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <label className="font-bold text-ink2">최종 학력</label>
                      <input
                        type="text"
                        value={editEmpEducation}
                        onChange={(e) => setEditEmpEducation(e.target.value)}
                        placeholder="예: 대학교 학사"
                        className="h-9 w-full rounded-lg border border-border bg-panel px-3 text-[12px] outline-none focus:border-teal"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="flex flex-col gap-1.5">
                      <label className="font-bold text-ink2">개인 이메일</label>
                      <input
                        type="email"
                        value={editEmpPersonalEmail}
                        onChange={(e) => setEditEmpPersonalEmail(e.target.value)}
                        placeholder="personal@email.com"
                        className="h-9 w-full rounded-lg border border-border bg-panel px-3 font-mono text-[12px] outline-none focus:border-teal"
                      />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <label className="font-bold text-ink2">비상 연락처</label>
                      <input
                        type="text"
                        value={editEmpEmergencyPhone}
                        onChange={(e) => setEditEmpEmergencyPhone(e.target.value)}
                        placeholder="010-9999-8888"
                        className="h-9 w-full rounded-lg border border-border bg-panel px-3 font-mono text-[12px] outline-none focus:border-teal"
                      />
                    </div>
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <label className="font-bold text-ink2">자택 주소</label>
                    <input
                      type="text"
                      value={editEmpAddress}
                      onChange={(e) => setEditEmpAddress(e.target.value)}
                      placeholder="지번/도로명 주소 입력"
                      className="h-9 w-full rounded-lg border border-border bg-panel px-3 text-[12px] outline-none focus:border-teal"
                    />
                  </div>
                </div>
              )}

              <div className="flex shrink-0 justify-end gap-2 border-t border-border/40 pt-3">
                <button
                  type="button"
                  onClick={() => setIsEditModalOpen(false)}
                  className="rounded-lg border px-4 py-2 font-bold text-ink2 hover:bg-panel-alt"
                >
                  취소
                </button>
                <button
                  type="submit"
                  className="rounded-lg bg-teal px-5 py-2 font-bold text-white hover:opacity-90"
                >
                  변경사항 저장
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}