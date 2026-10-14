/**
 * 재로그인 요청 — 서명 토큰이 없거나 만료되어 서버 기능(설문·메일·근태 조회)을 쓸 수 없을 때.
 *
 * 기능마다 빨간 오류 문구를 따로 띄우면 사용자가 당황한다. 각 gateway 는 이 신호만 보내고,
 * 앱 셸의 안내 창 하나(`ReloginDialog`)가 부드럽게 다시 로그인하도록 안내한다.
 * 토큰 서명키를 바꾸면(예: 운영 키 교체) 모든 직원이 한 번씩 이 안내를 보게 된다.
 */
export const RELOGIN_MESSAGE = '다시 로그인이 필요합니다. 보안 확인을 위해 한 번 더 로그인해 주세요.';

/** [나중에]를 누른 뒤 다시 띄우지 않는 시간. 기능을 누를 때마다 창이 뜨면 더 불편하다. */
export const RELOGIN_SNOOZE_MS = 10 * 60 * 1000;

const EVENT = 'workfit:relogin-required';

/**
 * 재로그인이 필요하다고 앱 셸에 알린다. 여러 곳에서 동시에 불러도 창은 하나만 뜬다.
 * `force` 는 사용자가 직접 [다시 로그인]을 누른 경우 — [나중에]로 미뤄 둔 상태여도 연다.
 */
export function requestRelogin(options: { force?: boolean } = {}): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(EVENT, { detail: { force: Boolean(options.force) } }));
}

export function onReloginRequired(listener: (force: boolean) => void): () => void {
  const handler = (event: Event) => listener(Boolean((event as CustomEvent<{ force?: boolean }>).detail?.force));
  window.addEventListener(EVENT, handler);
  return () => window.removeEventListener(EVENT, handler);
}

/** 화면이 오류를 그릴 때 — 재로그인 오류면 빨간 오류 대신 차분한 안내로 보여 준다. */
export function isReloginError(error: unknown): boolean {
  return error instanceof Error && error.message === RELOGIN_MESSAGE;
}

export function shouldShowRelogin(lastDismissedAt: number | null, now: number, force = false): boolean {
  return force || lastDismissedAt === null || now - lastDismissedAt >= RELOGIN_SNOOZE_MS;
}
