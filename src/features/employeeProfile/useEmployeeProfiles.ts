import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { employeeProfileRepo, type SelfEditableProfilePatch } from '@/data/employeeProfile/employeeProfile.repo';
import { userRepo } from '@/data/user/user.repo';
import type { EmployeeProfile, EmployeeProfileFormValues } from '@/domain/employeeProfile/schema';

const QUERY_KEY = ['employeeProfiles'] as const;

export function useEmployeeProfiles() {
  return useQuery({
    queryKey: QUERY_KEY,
    queryFn: () => employeeProfileRepo.list(),
  });
}

/**
 * 임직원 인사정보 발령 및 수정 Mutation.
 * 1) 신규 employeeProfiles 컬렉션에 인사/개인정보를 영구 저장.
 * 2) users 컬렉션에도 기본 소속(dept, position, jobTitle)을 동기화하여 전사 시스템 일관성을 유지.
 */
/** 본인 정보 수정(프로필 설정) — 연락처·주소·생년월일·생일 설정 등 허용 항목만 */
export function useUpdateMyEmployeeProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ me, patch }: {
      me: Parameters<typeof employeeProfileRepo.updateMine>[0];
      patch: SelfEditableProfilePatch;
    }) => employeeProfileRepo.updateMine(me, patch),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
      queryClient.invalidateQueries({ queryKey: ['users'] });
    },
  });
}

export function useUpsertEmployeeProfile() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, values }: { id: string; values: Partial<EmployeeProfileFormValues> }) => {
      const existing = await employeeProfileRepo.get(id);
      const updated: EmployeeProfile = {
        id,
        userId: values.userId || existing?.userId || id,
        empNo: values.empNo || existing?.empNo || id,
        name: values.name || existing?.name || '',
        dept: values.dept || existing?.dept || '미지정',
        position: values.position || existing?.position || '사원',
        jobTitle: values.jobTitle || existing?.jobTitle || '팀원',
        status: values.status || existing?.status || 'ACTIVE',
        isAttendanceTarget: values.isAttendanceTarget !== undefined ? values.isAttendanceTarget : (existing?.isAttendanceTarget ?? true),
        phone: values.phone !== undefined ? values.phone : (existing?.phone || ''),
        hireDate: values.hireDate !== undefined ? values.hireDate : (existing?.hireDate || ''),
        rrn: values.rrn !== undefined ? values.rrn : (existing?.rrn || ''),
        birthDate: values.birthDate !== undefined ? values.birthDate : (existing?.birthDate || ''),
        birthLunar: values.birthLunar !== undefined ? values.birthLunar : (existing?.birthLunar ?? false),
        birthdayPublic: values.birthdayPublic !== undefined ? values.birthdayPublic : (existing?.birthdayPublic ?? true),
        gender: values.gender !== undefined ? values.gender : (existing?.gender || ''),
        address: values.address !== undefined ? values.address : (existing?.address || ''),
        personalEmail: values.personalEmail !== undefined ? values.personalEmail : (existing?.personalEmail || ''),
        emergencyPhone: values.emergencyPhone !== undefined ? values.emergencyPhone : (existing?.emergencyPhone || ''),
        education: values.education !== undefined ? values.education : (existing?.education || ''),
        updatedAt: new Date().toISOString(),
      };

      // 1. employeeProfiles 저장
      await employeeProfileRepo.save(updated);

      // 2. users 컬렉션 기본 필드 동기화 (기존 시스템 호환)
      try {
        const u = await userRepo.get(updated.userId);
        if (u) {
          const userStatus = updated.status === 'ACTIVE' ? '사용' : updated.status === 'LEAVE' ? '잠금' : '미사용';
          await userRepo.save({
            ...u,
            dept: updated.dept,
            position: updated.position,
            jobTitle: updated.jobTitle,
            status: userStatus as any,
          });
        }
      } catch (err) {
        console.warn('Syncing to user record failed (non-blocking):', err);
      }

      return updated;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
      queryClient.invalidateQueries({ queryKey: ['users'] });
    },
  });
}
