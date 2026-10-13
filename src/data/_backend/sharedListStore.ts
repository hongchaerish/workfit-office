import { DocumentExistsError, type InsertableCrudBackend } from './crudBackend';

/**
 * 전 임직원이 함께 쓰는 설정 목록(연차 조정·대체휴무·결재 승계 등) — DB가 원천이다.
 *
 * 여러 화면이 이 목록을 동기 함수로 읽기 때문에 메모리에 캐시를 둔다. 로그인 직후
 * `SharedSettingsGate` 가 `hydrate()` 로 채운 다음 화면을 그리고, 이후 주기적으로 다시 읽는다.
 * 쓰기는 DB 반영이 끝나야 캐시에 반영된다(실패하면 캐시는 그대로, 오류는 호출부로).
 */
export interface SharedListStore<T> {
  /** 캐시된 전체 목록(동기). hydrate 전에는 빈 배열. */
  getAll(): T[];
  /** DB에서 다시 읽어 캐시를 갈아끼운다. */
  hydrate(): Promise<T[]>;
  save(item: T): Promise<void>;
  remove(id: string): Promise<void>;
  /** 테스트 전용 — 캐시 직접 설정. */
  setForTest(items: T[]): void;
}

export function createSharedListStore<T>(opts: {
  backend: InsertableCrudBackend<T>;
  idOf: (item: T) => string;
  /** 캐시가 바뀔 때 window 에 쏠 이벤트 이름(화면 갱신용). */
  event?: string;
}): SharedListStore<T> {
  const { backend, idOf, event } = opts;
  let cache: T[] = [];

  const set = (next: T[]) => {
    cache = next;
    if (event && typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
      window.dispatchEvent(new CustomEvent(event));
    }
  };

  return {
    getAll: () => cache,
    async hydrate() {
      set(await backend.loadAll());
      return cache;
    },
    async save(item) {
      await backend.save(item);
      const id = idOf(item);
      const i = cache.findIndex((x) => idOf(x) === id);
      set(i >= 0 ? cache.map((x, j) => (j === i ? item : x)) : [...cache, item]);
    },
    async remove(id) {
      await backend.remove(id);
      set(cache.filter((x) => idOf(x) !== id));
    },
    setForTest(items) {
      cache = items;
    },
  };
}

/**
 * 옛 브라우저(localStorage) 데이터를 DB로 옮긴다 — 같은 ID 문서가 이미 있으면 건너뛴다(덮어쓰지 않음).
 * @returns 새로 넣은 건수
 */
export async function migrateLegacyItems<T>(backend: InsertableCrudBackend<T>, items: T[]): Promise<number> {
  let inserted = 0;
  for (const item of items) {
    try {
      await backend.insert(item);
      inserted++;
    } catch (e) {
      if (!(e instanceof DocumentExistsError)) throw e;
    }
  }
  return inserted;
}

/**
 * localStorage 키에 남은 옛 값을 읽어 `migrate` 로 옮긴 뒤, 키를 `<키>.migrated` 로 바꿔 보관한다.
 * 다시 실행돼도 옮긴 키는 건너뛴다. 옮기다 실패하면 원래 키를 그대로 두어 다음에 다시 시도한다.
 */
export async function migrateLegacyKey(key: string, migrate: (raw: string) => Promise<number>): Promise<number> {
  if (typeof localStorage === 'undefined') return 0;
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(key);
  } catch {
    return 0;
  }
  if (!raw) return 0;
  const n = await migrate(raw);
  try {
    localStorage.setItem(`${key}.migrated`, raw);
    localStorage.removeItem(key);
  } catch {
    /* 보관 실패는 무시 — 다음에 다시 옮겨도 이미 있는 문서는 건너뛴다 */
  }
  return n;
}
