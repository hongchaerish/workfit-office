/**
 * Appwrite 호출 시간 제한.
 *
 * 이 인스턴스는 함수 안에서 보낸 요청 하나가 간헐적으로 응답 없이 멈춘다(2026-10-14 실측:
 * 동시에 보낸 명부 조회 4건 중 1건이 30초 내내 돌아오지 않아 실행 전체가 시간 초과).
 * node-appwrite 는 요청 취소를 받지 않으므로, 멈춘 시도는 버리고 새로 보낸다.
 *
 * 읽기만 다시 시도한다. 쓰기는 실제로 저장됐는데 응답만 늦은 것일 수 있어, 다시 보내면
 * 1인 1회 판정(참여 기록 생성)이 "이미 참여"로 뒤집힌다 — 쓰기는 attempts 1 로 부른다.
 *
 * `until` 은 요청 전체의 마감 시각(epoch ms)이다. 함수 실행 제한(30초)에 걸려 쓰는 도중
 * 강제 종료되지 않도록, 시도마다의 제한을 남은 시간으로 줄이고 마감이 지나면 보내지 않는다.
 */
export class DeadlineError extends Error {
  constructor(label: string, ms: number) {
    super(`설문 저장소 응답 시간 초과(${ms}ms): ${label}`);
    this.name = 'DeadlineError';
  }
}

export async function withDeadline<T>(
  run: () => Promise<T>,
  { timeoutMs, attempts, label = '', until }: { timeoutMs: number; attempts: number; label?: string; until?: number },
): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    const limit = until === undefined ? timeoutMs : Math.min(timeoutMs, until - Date.now());
    if (limit <= 0) throw new DeadlineError(label, timeoutMs);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new DeadlineError(label, limit)), limit);
    });
    try {
      return await Promise.race([run(), deadline]);
    } catch (error) {
      if (!(error instanceof DeadlineError) || attempt >= attempts) throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}
