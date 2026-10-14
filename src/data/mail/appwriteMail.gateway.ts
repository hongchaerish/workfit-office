import type { MailAccount, MailAccountDraft } from '@/domain/mailAccount/schema';
import { MailError, type InboxPage, type MailErrorCode } from '@/domain/mail/engine';
import type { MailDetail, MailFolder, MailRef } from '@/domain/mail/schema';
import { Functions } from 'appwrite';
import { client } from '@/shared/lib/appwrite';
import { getWiddyToken } from '@/data/widdyChat/widdyAuth';
import { RELOGIN_MESSAGE, requestRelogin } from '@/shared/lib/relogin';
import type {
  MailAttachmentContent,
  MailConnectionResult,
  MailCredential,
  MailGateway,
  MailSendResult,
} from './mail.gateway';

/**
 * Appwrite Function gateway — 운영 경로.
 *
 * WorkfitOffice는 Vite + React 정적 프런트라 Node 런타임이 없고, IMAP·SMTP는 브라우저에서
 * 열 수 없는 TCP 프로토콜이다. `appwrite/functions/mail` Function이 그 일을 대신한다.
 * MailHub 개발 브리지를 대체한다.
 *
 * **신원**: 요청 본문에 사용자 ID를 싣지 않는다. 로그인할 때 발급받아 둔 서명 토큰만 보내고,
 * Function이 서명을 검증해 uid를 도출한다. 브라우저가 uid를 주장할 수 없어야 남의 메일함이
 * 열리지 않는다.
 */

const FUNCTION_ID = (import.meta.env.VITE_MAIL_FUNCTION_ID as string | undefined) || 'mail';

/** Function이 붙어 있는지. Appwrite 미설정이면 화면은 메일 기능을 열지 않는다. */
export const isAppwriteMailConfigured = Boolean(client);

/** Function 오류 코드 → 도메인 코드. 모르는 값은 공급자 장애로 본다. */
const ERROR_MAP: Record<string, MailErrorCode> = {
  UNAUTHORIZED: 'FORBIDDEN',
  SERVER_NOT_CONFIGURED: 'PROVIDER_UNAVAILABLE',
  INVALID_INPUT: 'INVALID_INPUT',
  DUPLICATE: 'INVALID_INPUT',
  PROVIDER_UNAVAILABLE: 'PROVIDER_UNAVAILABLE',
  NOT_FOUND: 'NOT_FOUND',
  UNKNOWN_ACTION: 'INVALID_INPUT',
  INTERNAL: 'PROVIDER_UNAVAILABLE',
  // 연결 확인 단계에서 나오는 코드들
  AUTH_FAILED: 'AUTH_FAILED',
  TIMEOUT: 'TIMEOUT',
  TLS_FAILED: 'TLS_FAILED',
  UNREACHABLE: 'PROVIDER_UNAVAILABLE',
  CONNECT_FAILED: 'PROVIDER_UNAVAILABLE',
  // 발송·첨부
  NO_RECIPIENT: 'INVALID_INPUT',
  SEND_RECIPIENT_REJECTED: 'INVALID_INPUT',
  SEND_TIMEOUT: 'TIMEOUT',
  SEND_TOO_LARGE: 'INVALID_INPUT',
  SEND_ATTACHMENT_TOO_LARGE: 'INVALID_INPUT',
  SEND_FAILED: 'SEND_FAILED',
  ATTACHMENT_TOO_LARGE: 'INVALID_INPUT',
};

interface FnError {
  code: string;
  message: string;
}

/**
 * Function 호출.
 *
 * 토큰이 없으면 아예 보내지 않는다. Widdy는 토큰이 없으면 익명으로 강등되지만 메일은
 * 익명으로 열 수 있는 것이 없다 — 다시 로그인하라고 알리는 편이 낫다.
 */
async function call<T>(action: string, payload: Record<string, unknown> = {}): Promise<T> {
  if (!client) {
    throw new MailError('PROVIDER_UNAVAILABLE', '메일 서버가 설정되지 않았습니다.');
  }

  const token = getWiddyToken();
  if (!token) {
    requestRelogin();
    throw new MailError('FORBIDDEN', RELOGIN_MESSAGE);
  }

  let raw: string;
  let status: number;
  try {
    const execution = await new Functions(client).createExecution(
      FUNCTION_ID,
      JSON.stringify({ token, action, payload }),
      false,
    );
    raw = execution.responseBody ?? '';
    status = execution.responseStatusCode ?? 0;
  } catch {
    // Function 미배포·네트워크 단절·실행 자체가 거절된 경우가 여기로 온다.
    throw new MailError('PROVIDER_UNAVAILABLE', '메일 서버에 연결하지 못했습니다. 잠시 후 다시 시도하세요.');
  }

  /**
   * 빈 응답은 **성공이 아니다.**
   *
   * Function이 핸들러 밖에서 죽으면 런타임이 본문 없는 500을 내보낸다. 이걸 `{}`로 파싱해
   * 넘기면 `data`가 `undefined`인 채로 정상 반환되고, 화면은 "등록했습니다"를 띄운 뒤
   * 목록에서는 아무것도 못 찾는 상태가 된다. 실패는 실패로 올린다.
   */
  if (raw.trim() === '') {
    throw new MailError(
      'PROVIDER_UNAVAILABLE',
      `메일 서버가 응답을 반환하지 않았습니다. (HTTP ${status})`,
    );
  }

  let body: { data?: T; error?: FnError };
  try {
    body = JSON.parse(raw);
  } catch {
    throw new MailError('PROVIDER_UNAVAILABLE', '메일 서버 응답을 이해하지 못했습니다.');
  }

  if (body.error) {
    // 서명 토큰이 무효(키 교체·만료) — 앱 셸이 다시 로그인하도록 안내한다.
    if (status === 401) {
      requestRelogin();
      throw new MailError('FORBIDDEN', RELOGIN_MESSAGE);
    }
    const code = ERROR_MAP[body.error.code] ?? 'PROVIDER_UNAVAILABLE';
    throw new MailError(code, body.error.message || '메일 서버 요청을 처리하지 못했습니다.');
  }

  // `data` 자체가 없는 응답도 성공으로 취급하지 않는다. 계약은 `{data}` 또는 `{error}`뿐이다.
  if (!('data' in body)) {
    throw new MailError('PROVIDER_UNAVAILABLE', `메일 서버 응답 형식이 올바르지 않습니다. (HTTP ${status})`);
  }
  return body.data as T;
}

/**
 * 자격 증명 → 요청에 실을 앱 비밀번호.
 *
 * `mock`은 값이 없다는 뜻이라 그대로 흘려보낸다(수정 시 "비밀번호 안 바꿈"). OAuth는 아직
 * 공급자를 열지 않았으므로 여기서 막는다 — 조용히 무시하면 등록은 됐는데 인증이 안 되는
 * 계정이 남는다.
 */
function secretOf(credential: MailCredential | null): string | undefined {
  if (!credential || credential.kind === 'mock') return undefined;
  if (credential.kind === 'app_password') return credential.value;
  throw new MailError('PROVIDER_UNAVAILABLE', '이 인증 방식은 아직 지원하지 않습니다.');
}

export const appwriteMailGateway: MailGateway = {
  async testConnection(_ctx, draft, credential): Promise<MailConnectionResult> {
    return call<MailConnectionResult>('testConnection', {
      draft,
      secret: secretOf(credential),
    });
  },

  async createAccount(_ctx, draft, credential): Promise<MailAccount> {
    return call<MailAccount>('createAccount', { draft, secret: secretOf(credential) });
  },

  async listAccounts(): Promise<MailAccount[]> {
    return call<MailAccount[]>('listAccounts');
  },

  async updateAccount(_ctx, id, draft: MailAccountDraft, credential): Promise<MailAccount> {
    return call<MailAccount>('updateAccount', { id, draft, secret: secretOf(credential) });
  },

  async deleteAccount(_ctx, id): Promise<void> {
    await call<{ id: string }>('deleteAccount', { id });
  },

  // ── 메일함 ──

  async listFolders(_ctx, ...rest): Promise<Record<string, MailFolder[]>> {
    // 인터페이스에는 계정 인자가 없다. 서버가 소유자의 전 계정을 대상으로 삼는다.
    void rest;
    return call<Record<string, MailFolder[]>>('listFolders');
  },

  async countUnseen(): Promise<Record<string, number>> {
    return call<Record<string, number>>('countUnseen');
  },

  async listMails(_ctx, accountIds, folder, perAccount, query): Promise<InboxPage[]> {
    return call<InboxPage[]>('listMails', { accountIds, folder, perAccount, query });
  },

  async getMail(_ctx, ref: MailRef): Promise<MailDetail> {
    return call<MailDetail>('getMail', { ref });
  },

  async markRead(_ctx, refs, seen): Promise<void> {
    await call<{ updated: number }>('markRead', { refs, seen });
  },

  async markFlagged(_ctx, refs, flagged): Promise<void> {
    await call<{ updated: number }>('markFlagged', { refs, flagged });
  },

  async moveMail(_ctx, ref: MailRef, to: MailFolder): Promise<void> {
    await call<{ moved: boolean }>('moveMail', { ref, to });
  },

  // ── 발송·첨부 ──

  async sendMail(_ctx, input): Promise<MailSendResult> {
    /*
      도메인 형태({name,email} 배열·origin.ref) 그대로 보낸다. 주소 문자열 조합과 스레드
      헤더 구성은 서버 몫이다 — 원본 참조만 넘기면 서버가 원문을 다시 읽어 만든다.
    */
    return call<MailSendResult>('sendMail', { input });
  },

  async downloadAttachment(_ctx, ref: MailRef, index: number): Promise<MailAttachmentContent> {
    return call<MailAttachmentContent>('getAttachment', { ref, index });
  },
};
