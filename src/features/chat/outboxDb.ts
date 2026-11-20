/**
 * 보낼 메시지 보관함의 저장소 — 이 기기의 브라우저(IndexedDB)에 둔다. 사진·파일도 그대로 담긴다.
 * 앱을 끄거나 새로 고쳐도 남아서, 다시 열 때 이어 보내거나 '전송 실패'로 보여 줄 수 있다.
 * 저장소를 쓸 수 없는 환경(사생활 보호 모드 등)에서는 조용히 넘어간다 — 그때는 화면을 여는 동안만 유지된다.
 */
const DB_NAME = 'wf-chat-outbox';
const STORE = 'items';

let opening: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  opening ??= new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
    req.onsuccess = () => {
      // 휴대폰이 앱을 뒤로 보내며 연결을 끊는 일이 있다 — 다음에 쓸 때 새로 연다
      req.result.onclose = () => (opening = null);
      resolve(req.result);
    };
    req.onerror = () => reject(req.error);
  });
  return opening;
}

async function attempt<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise<T>((resolve, reject) => {
    const req = work(db.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>, fallback: T): Promise<T> {
  try {
    return await attempt(mode, work);
  } catch {
    // 끊긴 연결일 수 있다 — 새로 열어 한 번만 더 해 본다
    opening = null;
    try {
      return await attempt(mode, work);
    } catch (e) {
      console.warn('[chat] 보낼 메시지 보관 실패', e);
      return fallback;
    }
  }
}

export const outboxDb = {
  put: (record: { id: string }) => run<IDBValidKey>('readwrite', (s) => s.put(record), record.id),
  remove: (id: string) => run<undefined>('readwrite', (s) => s.delete(id), undefined),
  all: <T>() => run<T[]>('readonly', (s) => s.getAll() as IDBRequest<T[]>, []),
};
