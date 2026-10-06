/**
 * 기안 자동보관 키 — 새 기안은 **브라우저 탭마다** 따로 보관한다.
 *
 * 예전 키 `draft_autosave_{user}_new` 는 탭이 공유해서, 두 탭에서 새 기안을 쓰면 서로의
 * 보관본을 덮어썼다. 탭 ID(sessionStorage — 탭마다 따로, 새로고침해도 유지)를 키에 붙인다.
 *
 * 탭을 닫으면 그 ID 는 다시 오지 않으므로, 새 탭은 **닫힌 탭이 남긴 보관본**을 찾아 복구를
 * 제안한다. 열려 있는 탭인지는 탭이 주기적으로 남기는 생존 표시(`draft_tab_alive_{tabId}`)로 판단한다.
 * 기존 문서 수정(`docId` 있음)은 문서별 키를 그대로 쓴다.
 */

export interface KeyValueStorage {
  readonly length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const TAB_ID_KEY = 'draft_tab_id';
const ALIVE_PREFIX = 'draft_tab_alive_';
/**
 * 생존 표시 갱신 주기와, 이보다 오래 갱신이 없으면 닫힌 탭으로 보는 기준.
 * 브라우저는 오래 가려진 탭의 타이머를 1분에 한 번으로 늦추므로 기준을 그보다 넉넉히 둔다.
 * 정상적으로 닫힌 탭은 pagehide 때 표시를 지우므로 바로 복구 대상이 된다.
 */
export const TAB_HEARTBEAT_MS = 10_000;
export const TAB_STALE_MS = 150_000;
/** 이보다 오래된 보관본은 복구를 제안하지 않는다(보관함에는 남는다). */
export const DRAFT_OFFER_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** 탭 ID 는 16진 문자만 쓴다 — 보관함 목록이 `active` 가 든 키를 걸러내므로 겹치면 안 된다. */
function newTabId(): string {
  return Array.from({ length: 12 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
}

export function getDraftTabId(session: KeyValueStorage): string {
  const existing = session.getItem(TAB_ID_KEY);
  if (existing) return existing;
  const id = newTabId();
  session.setItem(TAB_ID_KEY, id);
  return id;
}

export function draftAutosaveKeys(userId: string, docId: string | null, tabId: string) {
  const suffix = docId ?? `new_${tabId}`;
  return {
    draftKey: `draft_autosave_${userId}_${suffix}`,
    activeKey: `draft_autosave_active_${userId}_${suffix}`,
  };
}

export const tabAliveKey = (tabId: string) => `${ALIVE_PREFIX}${tabId}`;

export function markTabAlive(storage: KeyValueStorage, tabId: string, now: number): void {
  storage.setItem(tabAliveKey(tabId), String(now));
}

export interface OrphanDraft {
  draftKey: string;
  activeKey: string;
  data: { timestamp: number } & Record<string, unknown>;
}

/**
 * 닫힌 탭(또는 예전 공유 키)이 남긴, 아직 복구 제안을 하지 않은 새 기안 보관본 중 가장 최근 것.
 * 지금 열려 있는 다른 탭의 보관본은 건드리지 않는다.
 */
export function findOrphanNewDraft(
  storage: KeyValueStorage,
  userId: string,
  ownTabId: string,
  now: number,
): OrphanDraft | null {
  const legacyKey = `draft_autosave_${userId}_new`;
  const tabPrefix = `${legacyKey}_`;
  const keys: string[] = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (key) keys.push(key);
  }

  let best: OrphanDraft | null = null;
  for (const draftKey of keys) {
    let tabId: string | null;
    if (draftKey === legacyKey) tabId = null;
    else if (draftKey.startsWith(tabPrefix)) tabId = draftKey.slice(tabPrefix.length);
    else continue;
    if (tabId === ownTabId) continue;
    if (tabId) {
      const lastSeen = Number(storage.getItem(tabAliveKey(tabId)) ?? 0);
      if (now - lastSeen < TAB_STALE_MS) continue; // 열려 있는 탭
    }

    const activeKey = draftKey.replace('draft_autosave_', 'draft_autosave_active_');
    if (storage.getItem(activeKey) !== 'true') continue; // 이미 제안했던 보관본

    let data: OrphanDraft['data'] | null = null;
    try {
      const parsed = JSON.parse(storage.getItem(draftKey) ?? 'null');
      if (parsed && typeof parsed === 'object' && typeof parsed.timestamp === 'number') data = parsed;
    } catch { /* 깨진 보관본은 건너뛴다 */ }
    if (!data || (data.docId ?? null) !== null) continue;
    if (now - data.timestamp >= DRAFT_OFFER_MAX_AGE_MS) continue;
    if (!best || data.timestamp > best.data.timestamp) best = { draftKey, activeKey, data };
  }
  return best;
}
