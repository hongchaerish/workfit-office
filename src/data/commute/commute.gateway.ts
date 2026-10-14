import { Functions } from 'appwrite';
import { client } from '@/shared/lib/appwrite';
import { getWiddyToken } from '@/data/widdyChat/widdyAuth';
import { RELOGIN_MESSAGE, requestRelogin } from '@/shared/lib/relogin';
import {
  commuteEmployeeSchema,
  commuteRecordSchema,
  commuteViewerSchema,
  type CommuteEmployee,
  type CommuteRecord,
  type CommuteViewer,
} from '@/domain/commute/schema';

/**
 * 근태 조회 게이트웨이 — `caps-ingest` Function 경유.
 *
 * 근태 컬렉션(`employees`·`attendance`)은 개인정보라 **서버 전용 권한**으로 만들어져 있고,
 * 브라우저는 프로젝트 ID만 가진 익명 클라이언트라 직접 읽으면 401이다. 컬렉션을 열어
 * 해결하면 projectId가 번들에 공개돼 있으므로 누구나 전 직원 출퇴근 기록을 가져갈 수 있다.
 * 그래서 메일과 같은 방식으로 **Function이 대신 읽어 내려준다.**
 *
 * 신원은 `widdy-login`이 발급한 서명 토큰이다. 적재(에이전트)와 조회(화면)가 한 함수를
 * 쓰지만 인증 수단이 다르다 — 적재는 HMAC 서명 헤더, 조회는 이 토큰이다.
 */

const FUNCTION_ID = (import.meta.env.VITE_CAPS_FUNCTION_ID as string | undefined) || 'caps-ingest';

/** Function이 붙어 있는지. 붙어 있지 않으면 화면은 fixture로 물러선다. */
export const isCommuteBackendReady = Boolean(client);

export class CommuteGatewayError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'CommuteGatewayError';
  }
}

function getCurrentUserId(): string | null {
  try {
    return localStorage.getItem('mes.auth.uid') || localStorage.getItem('workfit.auth.session');
  } catch {
    return null;
  }
}

async function call<T>(action: string, payload: Record<string, unknown> = {}): Promise<T> {
  if (!client) throw new CommuteGatewayError('UNAVAILABLE', '근태 서버가 설정되지 않았습니다.');

  const token = getWiddyToken();
  const userId = getCurrentUserId();
  if (!token && !userId) {
    requestRelogin();
    throw new CommuteGatewayError('FORBIDDEN', RELOGIN_MESSAGE);
  }

  let raw: string;
  let status: number;
  try {
    const execution = await new Functions(client).createExecution(
      FUNCTION_ID,
      JSON.stringify({ token, userId, action, payload }),
      false,
    );
    raw = execution.responseBody ?? '';
    status = execution.responseStatusCode ?? 0;
  } catch {
    throw new CommuteGatewayError('UNAVAILABLE', '근태 서버에 연결하지 못했습니다.');
  }

  /*
    빈 응답은 성공이 아니다. Function이 핸들러 밖에서 죽으면 런타임이 본문 없는 500을 내는데,
    그걸 `{}`로 읽으면 "조회는 됐는데 근태가 하나도 없다"로 보인다.
  */
  if (raw.trim() === '') {
    throw new CommuteGatewayError('UNAVAILABLE', `근태 서버가 응답하지 않았습니다. (HTTP ${status})`);
  }

  let body: { data?: T; error?: { code: string; message: string } };
  try {
    body = JSON.parse(raw);
  } catch {
    throw new CommuteGatewayError('UNAVAILABLE', '근태 서버 응답을 이해하지 못했습니다.');
  }

  if (body.error) throw new CommuteGatewayError(body.error.code, body.error.message);
  if (!('data' in body)) {
    throw new CommuteGatewayError('UNAVAILABLE', `근태 서버 응답 형식이 올바르지 않습니다. (HTTP ${status})`);
  }
  return body.data as T;
}

/** 스키마에 안 맞는 행은 버린다. 한 행 때문에 목록 전체가 막히지 않게. */
const parseRows = <T>(rows: unknown[], schema: { safeParse: (v: unknown) => { success: boolean; data?: T } }): T[] =>
  rows.flatMap((row) => {
    const parsed = schema.safeParse(row);
    return parsed.success && parsed.data ? [parsed.data] : [];
  });

export const commuteGateway = {
  /** 내 열람 범위. 화면이 자기 권한을 스스로 판정하지 않도록 서버에 물어본다. */
  async viewerScope(): Promise<CommuteViewer> {
    return commuteViewerSchema.parse(await call<unknown>('viewerScope'));
  },

  async listEmployees(): Promise<CommuteEmployee[]> {
    const rows = await call<unknown[]>('listEmployees');
    return parseRows(rows, commuteEmployeeSchema);
  },

  async listMonth(empId: number, month: string): Promise<CommuteRecord[]> {
    const rows = await call<unknown[]>('listMonth', { empId, month });
    return parseRows(rows, commuteRecordSchema);
  },

  /** 하루치 전 직원. 날짜만으로 거르므로 서버가 `idx_date`를 탄다. */
  async listDay(date: string): Promise<CommuteRecord[]> {
    const rows = await call<unknown[]>('listDay', { date });
    return parseRows(rows, commuteRecordSchema);
  },

  /** 한 달치 전 직원. 집계 화면이 사람별로 묶어 쓴다. */
  async listMonthAll(month: string): Promise<CommuteRecord[]> {
    const rows = await call<unknown[]>('listMonthAll', { month });
    return parseRows(rows, commuteRecordSchema);
  },
};
