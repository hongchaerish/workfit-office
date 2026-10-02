/**
 * 사용자 활동 감지 — 자리비움 판정용 '마지막 활동 시각'을 갱신한다.
 *
 * 1. 워크핏 창 안의 키보드·마우스 입력(모든 브라우저).
 * 2. Idle Detection API(Chrome·Edge·Android Chrome) — 다른 프로그램을 쓰고 있어도 **이 PC의
 *    입력 유무와 화면 잠금**을 알려준다(입력 내용은 알 수 없음). 사용자가 한 번 허용해야 하며,
 *    브라우저 규칙상 권한 요청은 클릭 같은 사용자 동작 안에서만 할 수 있다 — 로그인 후 첫 클릭에
 *    한 번 묻는다. 거부·미지원이면 1번만으로 판단한다.
 */

interface IdleDetectorLike extends EventTarget {
  userState: 'active' | 'idle' | null;
  screenState: 'locked' | 'unlocked' | null;
  start(options: { threshold: number; signal?: AbortSignal }): Promise<void>;
}
interface IdleDetectorCtor {
  new (): IdleDetectorLike;
  requestPermission(): Promise<'granted' | 'denied'>;
}

const IDLE_THRESHOLD_MS = 60 * 1000; // API 최소값
const POINTER_MOVE_THROTTLE_MS = 15 * 1000;

const idleDetectorCtor = (): IdleDetectorCtor | null =>
  typeof window !== 'undefined' && 'IdleDetector' in window
    ? ((window as unknown as { IdleDetector: IdleDetectorCtor }).IdleDetector)
    : null;

/**
 * 활동 감지를 시작한다. `onActivity(at)` 은 활동이 있었던 시각을 넘긴다.
 * `isSystemActive()` 는 Idle Detection 이 켜져 있고 지금 사용 중이면 true — 하트비트가
 * 창 밖에서 일하는 동안에도 활동으로 기록할 수 있게 한다.
 */
export function startActivityTracking(onActivity: (at: number) => void): {
  stop: () => void;
  isSystemActive: () => boolean;
} {
  const abort = new AbortController();
  let detector: IdleDetectorLike | null = null;
  let lastMove = 0;

  const mark = () => onActivity(Date.now());
  const onMove = () => {
    const t = Date.now();
    if (t - lastMove < POINTER_MOVE_THROTTLE_MS) return;
    lastMove = t;
    onActivity(t);
  };
  const opts = { passive: true, signal: abort.signal } as AddEventListenerOptions;
  for (const type of ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const) window.addEventListener(type, mark, opts);
  window.addEventListener('pointermove', onMove, opts);
  window.addEventListener('focus', mark, opts);

  const startDetector = async () => {
    const Ctor = idleDetectorCtor();
    if (!Ctor || detector) return;
    try {
      const d = new Ctor();
      d.addEventListener('change', () => {
        if (d.userState === 'active' && d.screenState !== 'locked') onActivity(Date.now());
        // idle 로 바뀐 시점의 실제 마지막 입력은 임계값만큼 전이다
        else onActivity(Date.now() - IDLE_THRESHOLD_MS);
      });
      await d.start({ threshold: IDLE_THRESHOLD_MS, signal: abort.signal });
      detector = d;
    } catch {
      /* 권한 없음·정책 차단 — 창 안 입력만으로 판단 */
    }
  };

  // 이미 허용돼 있으면 바로, 아니면 첫 클릭에 한 번 묻는다.
  const Ctor = idleDetectorCtor();
  if (Ctor) {
    const askOnFirstClick = () => {
      Ctor.requestPermission()
        .then((p) => (p === 'granted' ? startDetector() : undefined))
        .catch(() => undefined);
    };
    navigator.permissions
      ?.query({ name: 'idle-detection' as PermissionName })
      .then((status) => {
        if (status.state === 'granted') void startDetector();
        else if (status.state === 'prompt') window.addEventListener('pointerdown', askOnFirstClick, { once: true, signal: abort.signal });
      })
      .catch(() => undefined);
  }

  return {
    stop: () => abort.abort(),
    isSystemActive: () => Boolean(detector && detector.userState === 'active' && detector.screenState !== 'locked'),
  };
}
