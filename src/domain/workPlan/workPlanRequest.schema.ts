import { z } from 'zod';

export type WorkPlanRequestStatus = 'PENDING' | 'ACCEPTED' | 'REJECTED';

export const workPlanRequestSchema = z.object({
  id: z.string(),
  requesterId: z.string(),
  requesterName: z.string(),
  requesterDept: z.string(),
  targetUserId: z.string(),
  targetUserName: z.string(),
  targetUserDept: z.string(),
  date: z.string(), // YYYY-MM-DD
  title: z.string(),
  timeStr: z.string().optional(), // 예: '10:00~11:00'
  tag: z.string().optional(),     // 예: '회의', '업무'
  memo: z.string().optional(),
  status: z.enum(['PENDING', 'ACCEPTED', 'REJECTED']).default('PENDING'),
  createdAt: z.string(),
  updatedAt: z.string().optional(),
  responseComment: z.string().optional(),
});

export type WorkPlanRequest = z.infer<typeof workPlanRequestSchema>;
