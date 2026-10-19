import { departmentRepo } from '@/data/department/department.repo';
import { positionRepo } from '@/data/position/position.repo';
import { jobTitleRepo } from '@/data/jobTitle/jobTitle.repo';
import type { OrgMasters } from '@/domain/employeeProfile/affiliation';

/** 소속 이름을 찾을 기준정보(부서·직급·직책). 읽기·저장 때마다 DB에서 새로 읽는다. */
export async function loadOrgMasters(): Promise<OrgMasters> {
  const [depts, positions, jobTitles] = await Promise.all([departmentRepo.list(), positionRepo.list(), jobTitleRepo.list()]);
  return { depts, positions, jobTitles };
}
