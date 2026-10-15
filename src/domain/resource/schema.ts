import { z } from 'zod';

export const RESOURCE_TYPES = ['ROOM', 'VEHICLE', 'EQUIPMENT', 'SUPPLY'] as const;
export const RESOURCE_BOOKING_MODES = ['TIME_SLOT', 'QUANTITY'] as const;
export const RESOURCE_APPROVAL_MODES = ['INSTANT', 'APPROVAL'] as const;
export const RESOURCE_STATUSES = ['ACTIVE', 'MAINTENANCE', 'INACTIVE'] as const;

const hhmmSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, '시간은 HH:mm 형식이어야 합니다.');

export const resourceSchema = z.object({
  id: z.string().min(1),
  code: z.string().trim().min(1, '자원 코드를 입력하세요.').max(30),
  name: z.string().trim().min(1, '자원명을 입력하세요.').max(60),
  typeCode: z.enum(RESOURCE_TYPES),
  bookingMode: z.enum(RESOURCE_BOOKING_MODES),
  location: z.string().trim().min(1, '위치를 입력하세요.').max(100),
  description: z.string().trim().max(300),
  capacity: z.number().int().positive().nullable(),
  totalQuantity: z.number().int().min(1),
  unitCode: z.string().trim().min(1).max(20),
  managerUserId: z.string().nullable(),
  ownerDeptId: z.string().nullable(),
  approvalMode: z.enum(RESOURCE_APPROVAL_MODES),
  slotMinutes: z.number().int().min(10).max(1440),
  minDurationMinutes: z.number().int().min(10).max(1440),
  maxDurationMinutes: z.number().int().min(10).max(1440),
  bufferBeforeMinutes: z.number().int().min(0).max(1440),
  bufferAfterMinutes: z.number().int().min(0).max(1440),
  maxAdvanceDays: z.number().int().min(0).max(365),
  cancelDeadlineMinutes: z.number().int().min(0).max(10080),
  availableFrom: hhmmSchema,
  availableTo: hhmmSchema,
  status: z.enum(RESOURCE_STATUSES),
  imageUrl: z.string().nullable(),
  notes: z.string().trim().max(500),
  createdBy: z.string().min(1),
  createdAt: z.string().datetime(),
  updatedBy: z.string().min(1),
  updatedAt: z.string().datetime(),
}).superRefine((value, ctx) => {
  if (value.bookingMode === 'TIME_SLOT' && value.totalQuantity !== 1) {
    ctx.addIssue({ code: 'custom', path: ['totalQuantity'], message: '시간형 자원의 전체 수량은 1이어야 합니다.' });
  }
  if (value.minDurationMinutes > value.maxDurationMinutes) {
    ctx.addIssue({ code: 'custom', path: ['maxDurationMinutes'], message: '최대 이용시간은 최소 이용시간 이상이어야 합니다.' });
  }
  if (value.availableFrom >= value.availableTo) {
    ctx.addIssue({ code: 'custom', path: ['availableTo'], message: '운영 종료시간은 시작시간보다 늦어야 합니다.' });
  }
  if (value.typeCode === 'ROOM' && value.capacity == null) {
    ctx.addIssue({ code: 'custom', path: ['capacity'], message: '회의실 수용 인원을 입력하세요.' });
  }
  if (value.approvalMode === 'APPROVAL' && !value.managerUserId) {
    ctx.addIssue({ code: 'custom', path: ['managerUserId'], message: '승인형 자원에는 담당자를 지정하세요.' });
  }
});

export type Resource = z.infer<typeof resourceSchema>;
export type ResourceType = (typeof RESOURCE_TYPES)[number];
export type ResourceBookingMode = (typeof RESOURCE_BOOKING_MODES)[number];
export type ResourceApprovalMode = (typeof RESOURCE_APPROVAL_MODES)[number];
export type ResourceStatus = (typeof RESOURCE_STATUSES)[number];

export type ResourceDraft = Omit<Resource, 'id' | 'createdBy' | 'createdAt' | 'updatedBy' | 'updatedAt'>;

export const RESOURCE_TYPE_LABELS: Record<ResourceType, string> = {
  ROOM: '회의실',
  VEHICLE: '법인차량',
  EQUIPMENT: '공용장비',
  SUPPLY: '공용물품',
};

export const RESOURCE_STATUS_LABELS: Record<ResourceStatus, string> = {
  ACTIVE: '사용',
  MAINTENANCE: '유지보수',
  INACTIVE: '미사용',
};
