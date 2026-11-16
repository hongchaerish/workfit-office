import { departmentRepo } from '@/data/department/department.repo';
import { chatRoomRepo } from '@/data/chatRoom/chatRoom.repo';
import type { Department } from '@/domain/department/schema';

/**
 * 부서 저장 + 그 자리에서 부서방 맞추기(새 부서는 방 개설, 이름이 바뀌면 방 이름 따라가기).
 * 다른 직원 화면에는 메신저 실시간 신호로 바로 보인다. 부서방 맞추기가 실패해도 부서 저장은 그대로다.
 */
export async function saveDepartment(d: Department): Promise<void> {
  await departmentRepo.save(d);
  await chatRoomRepo.syncDeptRooms();
}
