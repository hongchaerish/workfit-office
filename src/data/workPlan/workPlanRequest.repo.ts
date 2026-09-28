import type { WorkPlanRequest } from '@/domain/workPlan/workPlanRequest.schema';
import { notificationRepo } from '@/data/notification/notification.repo';
import { workPlanRepo } from './workPlan.repo';
import { syncWorkPlanToCalendar } from '@/domain/workPlan/workPlanCalendarBridge';

const STORAGE_KEY = 'workfit_workplan_requests_v1';

export class WorkPlanRequestRepo {
  private getAll(): WorkPlanRequest[] {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      return JSON.parse(raw) as WorkPlanRequest[];
    } catch {
      return [];
    }
  }

  private saveAll(list: WorkPlanRequest[]): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
      window.dispatchEvent(new CustomEvent('workfit:workplan_requests_updated'));
    } catch {
      // ignore
    }
  }

  async listByTarget(targetUserId: string): Promise<WorkPlanRequest[]> {
    const all = this.getAll();
    return all
      .filter((r) => r.targetUserId === targetUserId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async listByRequester(requesterId: string): Promise<WorkPlanRequest[]> {
    const all = this.getAll();
    return all
      .filter((r) => r.requesterId === requesterId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async create(data: Omit<WorkPlanRequest, 'id' | 'createdAt' | 'status'>): Promise<WorkPlanRequest> {
    const all = this.getAll();
    const newId = `wpr-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    const newReq: WorkPlanRequest = {
      ...data,
      id: newId,
      status: 'PENDING',
      createdAt: new Date().toISOString(),
    };

    all.unshift(newReq);
    this.saveAll(all);

    // 1) 대상자에게 실시간 알림 발송
    try {
      const timeInfo = newReq.timeStr ? ` (${newReq.timeStr})` : '';
      await notificationRepo.create({
        userId: newReq.targetUserId,
        type: '일정',
        title: '업무계획 일정 추가 요청',
        text: `${newReq.requesterName}님이 ${newReq.date}${timeInfo} 일정 추가를 요청했습니다: "${newReq.title}"`,
        senderName: newReq.requesterName,
        linkUrl: `/gw/task/plan?date=${newReq.date}`,
      });
    } catch (e) {
      console.warn('[WorkPlanRequestRepo] 알림 발송 실패:', e);
    }

    return newReq;
  }

  async accept(id: string): Promise<WorkPlanRequest> {
    const all = this.getAll();
    const idx = all.findIndex((r) => r.id === id);
    if (idx === -1) throw new Error('요청을 찾을 수 없습니다.');

    const req = all[idx];
    req.status = 'ACCEPTED';
    req.updatedAt = new Date().toISOString();
    this.saveAll(all);

    // 1) 대상자의 실제 해당 날짜 WorkPlan에 해당 일정 항목 자동 삽입/병합
    try {
      const allPlans = await workPlanRepo.listAll();
      const existingPlan = allPlans.find(
        (p) => p.ownerUserId === req.targetUserId && p.date === req.date,
      );

      const tagPrefix = req.tag ? `[${req.tag}] ` : '';
      const timePrefix = req.timeStr ? `${req.timeStr} ` : '';
      const memoSuffix = req.memo ? ` (${req.memo})` : '';
      const newItemText = `[요청: ${req.requesterName}] ${tagPrefix}${timePrefix}${req.title}${memoSuffix}`;

      const targetActor = { userId: req.targetUserId, active: true };
      let savedPlan;

      if (existingPlan) {
        const updatedContent = `${existingPlan.content.trim()}\n${newItemText}`;
        savedPlan = await workPlanRepo.update(targetActor, existingPlan.id, {
          date: req.date,
          content: updatedContent,
        });
      } else {
        savedPlan = await workPlanRepo.create(targetActor, {
          date: req.date,
          content: newItemText,
        });
      }

      // 캘린더 동기화
      if (savedPlan) {
        await syncWorkPlanToCalendar(targetActor, savedPlan).catch(() => {});
      }
    } catch (e) {
      console.error('[WorkPlanRequestRepo] 업무계획 반영 실패:', e);
    }

    // 2) 요청자에게 수락 완료 알림 발송
    try {
      await notificationRepo.create({
        userId: req.requesterId,
        type: '일정',
        title: '일정 요청 수락',
        text: `${req.targetUserName}님이 ${req.date} 일정 요청("${req.title}")을 수락하여 업무계획서에 반영했습니다.`,
        senderName: req.targetUserName,
        linkUrl: `/gw/task/plan?date=${req.date}`,
      });
    } catch (e) {
      console.warn('[WorkPlanRequestRepo] 알림 발송 실패:', e);
    }

    return req;
  }

  async reject(id: string, reason?: string): Promise<WorkPlanRequest> {
    const all = this.getAll();
    const idx = all.findIndex((r) => r.id === id);
    if (idx === -1) throw new Error('요청을 찾을 수 없습니다.');

    const req = all[idx];
    req.status = 'REJECTED';
    req.responseComment = reason;
    req.updatedAt = new Date().toISOString();
    this.saveAll(all);

    // 요청자에게 반려 알림 발송
    try {
      const reasonText = reason ? ` (반려 사유: ${reason})` : '';
      await notificationRepo.create({
        userId: req.requesterId,
        type: '일정',
        title: '일정 요청 반려',
        text: `${req.targetUserName}님이 ${req.date} 일정 요청("${req.title}")을 반려했습니다.${reasonText}`,
        senderName: req.targetUserName,
        linkUrl: `/gw/task/plan?date=${req.date}`,
      });
    } catch (e) {
      console.warn('[WorkPlanRequestRepo] 알림 발송 실패:', e);
    }

    return req;
  }
}

export const workPlanRequestRepo = new WorkPlanRequestRepo();
