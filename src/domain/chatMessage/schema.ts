import { z } from 'zod';

/**
 * 채팅 메시지(ChatMessage) 도메인 스키마 — 단일 진실 공급원(SSOT).
 * 방(chatRooms) 안의 개별 메시지. ([[메신저_개발_계획서.md]] §5.2)
 *
 * 저장: 코드베이스 정본대로 플랫 top-level 컬렉션 `chatMessages`(roomId 필드로 방 구분).
 *   서브컬렉션 대신 플랫 — 기존 118개 컬렉션·시드러너 균일 매핑과 일치.
 * type: text(일반) / system(입장·초대 안내 등 가운데 캡슐).
 * readBy: 읽은 users.id 배열 → 미읽음은 저장하지 않고 여기서 도출.
 */
export const CHAT_MESSAGE_TYPES = ['text', 'system', 'image', 'file', 'approval_bot'] as const;
export type ChatMessageType = (typeof CHAT_MESSAGE_TYPES)[number];

/** 첨부 허용 최대 용량(데모: 10MB). storage.rules·업로드 repo·입력 UI 3곳에서 강제. */
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

/** 첨부(이미지/파일) 메타. type이 image/file 일 때 채워진다. Storage 업로드 결과. */
export const attachmentSchema = z.object({
  /** Storage download URL(이미지 표시·파일 다운로드). */
  url: z.string(),
  /** 원본 파일명. */
  name: z.string(),
  /** 바이트 크기. */
  size: z.number(),
  /** MIME 타입(image/* 여부로 미리보기 판단). */
  mime: z.string(),
  /** 저장소 경로 — 메시지 삭제 시 파일까지 지우는 데 쓴다. 예전 메시지에는 없다. */
  path: z.string().optional(),
  /** 서식 메시지(rich)에서 본문 속 사진이 이 첨부를 가리키는 id. */
  id: z.string().optional(),
});
export type Attachment = z.infer<typeof attachmentSchema>;

/** 답글(인용) 미리보기 — 원문 메시지 요약. 모바일 앱과 동일 shape. */
export const replyPreviewSchema = z.object({
  id: z.string(),
  senderName: z.string(),
  text: z.string(),
});
export type ReplyPreview = z.infer<typeof replyPreviewSchema>;

/**
 * 전자결재 알림 봇 카드 페이로드 — type='approval_bot' 메시지에 담긴다.
 * Flutter 앱(ApprovalBotPayload)·PWA·웹이 공유하는 shape. 탭 시 해당 결재문서 상세로 이동.
 */
export const approvalBotPayloadSchema = z.object({
  docId: z.string().default(''),
  docNo: z.string().default(''),
  title: z.string().default(''),
  drafterName: z.string().default(''),
  drafterDept: z.string().default(''),
  status: z.string().default('진행중'),
  currentSeq: z.number().default(1),
});
export type ApprovalBotPayload = z.infer<typeof approvalBotPayloadSchema>;

export const chatMessageSchema = z.object({
  id: z.string().min(1),
  roomId: z.string().min(1),
  /** 보낸 사람 users.id. system 메시지는 빈 문자열. */
  senderId: z.string().default(''),
  senderName: z.string().default(''),
  text: z.string(),
  type: z.enum(CHAT_MESSAGE_TYPES).default('text'),
  /** image/file 메시지의 첨부 메타. text/system 은 null. */
  attachment: attachmentSchema.nullable().default(null),
  /** 답글(인용) 원문 요약. 일반 메시지는 null. (모바일 앱과 공유) */
  replyTo: replyPreviewSchema.nullable().default(null),
  /** 전자결재 알림 봇 카드 페이로드. type='approval_bot' 일 때만 존재. (Flutter 앱과 공유) */
  approvalPayload: approvalBotPayloadSchema.nullable().default(null),
  /** 전송 시각(ISO). 방 안 정렬 키. */
  at: z.string(),
  readBy: z.array(z.string()).default([]),
  isEdited: z.boolean().optional().default(false),
  reactions: z.record(z.string(), z.array(z.string())).optional().default({}),
  /**
   * 본문 형식. 없거나 'plain' 이면 text 를 그대로 그린다.
   * 'rich' 는 body(서식 문서 JSON — domain/chatMessage/richBody)와 attachments 를 그리고,
   * text 에는 평문 요약(검색·알림·미리보기·답장 인용용)을 담는다. 메시지 1건이 글·사진·파일을 모두 담는다.
   */
  format: z.enum(['plain', 'rich']).optional(),
  /** rich 본문 — 서식 문서 JSON 문자열 */
  body: z.string().nullable().optional(),
  /** rich 메시지의 첨부(본문 속 사진 + 파일). 본문 속 사진은 attachments[].id 로 가리킨다. */
  attachments: z.array(attachmentSchema).optional(),
  /** rich 본문에서 @멘션한 사용자 id */
  mentions: z.array(z.string()).optional(),
  /** 삭제(모두에게서) 시각·삭제자. 삭제되지 않은 메시지는 null. (domain/chatMessage/deletion) */
  deletedAt: z.string().nullable().optional(),
  deletedBy: z.string().nullable().optional(),
  deletedByName: z.string().nullable().optional(),
});

export type ChatMessage = z.infer<typeof chatMessageSchema>;
