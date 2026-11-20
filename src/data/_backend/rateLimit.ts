/*
  여러 건을 한 건씩 서버에 보낼 때 — 요청 한도(Appwrite 429 'Rate limit ... exceeded')에 걸리면
  잠깐 기다렸다 같은 건을 다시 보낸다. 루틴처럼 수십~백 건을 만들거나 지울 때 중간에 멈추지 않게.
*/

export const isRateLimited = (error: unknown): boolean => {
  const e = error as { code?: number; message?: string } | null;
  return e?.code === 429 || /rate limit/i.test(String(e?.message ?? ''));
};

export interface RetryOptions {
  /** 한 건당 다시 보내는 최대 횟수 */
  retries?: number;
  /** 첫 기다림(ms) — 다시 보낼 때마다 두 배 */
  baseMs?: number;
  /** 시험에서 바꿔 끼운다 */
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** 요청 한도에 걸리면 기다렸다 다시 — 다른 오류는 바로 던진다 */
export async function withRateLimitRetry<T>(fn: () => Promise<T>, { retries = 6, baseMs = 1000, sleep = defaultSleep }: RetryOptions = {}): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      if (!isRateLimited(error) || attempt >= retries) throw error;
      await sleep(Math.min(baseMs * 2 ** attempt, 15000));
    }
  }
}

/** 여러 건을 차례로 처리하다 멈췄을 때 — 몇 건까지 됐는지 함께 알린다 */
export class PartialBatchError extends Error {
  constructor(
    readonly done: number,
    readonly total: number,
    readonly cause: unknown,
  ) {
    super(`${total}건 중 ${done}건만 처리했습니다. 잠시 후 다시 시도하면 나머지를 처리합니다.`);
    this.name = 'PartialBatchError';
  }
}

/** 한 건씩 차례로(요청 한도 재시도 포함). 끝내 실패하면 PartialBatchError — 이미 처리한 건수는 done */
export async function runEachWithRetry<T>(items: readonly T[], fn: (item: T) => Promise<void>, options?: RetryOptions): Promise<void> {
  let done = 0;
  for (const item of items) {
    try {
      await withRateLimitRetry(() => fn(item), options);
    } catch (error) {
      throw new PartialBatchError(done, items.length, error);
    }
    done += 1;
  }
}
