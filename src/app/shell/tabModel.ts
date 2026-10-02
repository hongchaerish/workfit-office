import type { FlatScreen } from '@/shared/types/menu';

/**
 * 셸 탭. `url` 은 경로(화면 판정·표시용), `href` 는 쿼리까지 포함한 전체 주소다.
 *
 * 예전에는 경로만 기억해 `/gw/approval/new?type=휴가` 로 기안을 쓰다 다른 탭에 다녀오면
 * `/gw/approval/new` 로 돌아와 서식 없는 빈 기안(서식 선택 창)이 떴다.
 */
export interface ShellTab extends FlatScreen {
  href: string;
}

/**
 * 현재 주소의 화면을 탭 목록에 반영한다 — 앱(`id`) 단위로 탭을 하나만 두고,
 * 이미 열려 있으면 그 탭의 주소만 옮긴다(브라우저 탭에서 같은 사이트를 옮겨 다니는 것과 같다).
 */
export function syncTab(tabs: ShellTab[], screen: FlatScreen, href: string): ShellTab[] {
  const i = tabs.findIndex((t) => t.id === screen.id);
  if (i === -1) return [...tabs, { ...screen, href }];
  if (tabs[i].href === href && tabs[i].url === screen.url) return tabs;
  return tabs.map((t, idx) => (idx === i ? { ...t, url: screen.url, href } : t));
}

/** 탭을 닫는다. 활성 탭을 닫으면 오른쪽(없으면 왼쪽) 탭의 주소로 이동해야 한다. */
export function closeTab(
  tabs: ShellTab[],
  id: string,
  activeId: string | null,
): { tabs: ShellTab[]; nextHref: string | null } {
  const idx = tabs.findIndex((t) => t.id === id);
  if (idx === -1) return { tabs, nextHref: null };
  const next = tabs.filter((t) => t.id !== id);
  if (id !== activeId) return { tabs: next, nextHref: null };
  const neighbor = next[idx] ?? next[idx - 1];
  return { tabs: next, nextHref: neighbor?.href ?? null };
}

/**
 * 셸 이동 표시(`navigate(to, { state })`).
 * - `restore`: 탭 전환 — 그 탭이 갖고 있던 화면 위치(location)를 그대로 되살린다.
 *   새 이동으로 보면 딥링크(?doc=…)가 다시 적용돼 사용자가 옮겨 간 화면이 되돌아간다.
 * - `open-app`: 도크·메뉴에서 앱 열기 — 이미 탭으로 열려 있으면 그 탭으로 돌아간다
 *   (작성 중이던 기안 대신 앱 첫 화면으로 덮어쓰지 않는다).
 */
export type ShellNavState = { shellTab?: 'restore' | 'open-app' };

export const restoreTabState: ShellNavState = { shellTab: 'restore' };
export const openAppState: ShellNavState = { shellTab: 'open-app' };
