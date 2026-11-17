/** 일시적인 실패를 정해 둔 간격으로 다시 시도한다(기본 0.4초·1.2초 뒤 두 번). 마지막 실패는 그대로 던진다 */
export async function withRetry<T>(run: () => Promise<T>, waits: number[] = [400, 1200]): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await run();
    } catch (e) {
      if (i >= waits.length) throw e;
      await new Promise((r) => setTimeout(r, waits[i]));
    }
  }
}
