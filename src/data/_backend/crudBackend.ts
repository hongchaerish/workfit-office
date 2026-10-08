import { collection, deleteDoc, doc, getDocs, runTransaction, setDoc } from 'firebase/firestore';
import { db } from '@/shared/lib/firebase';
import { databases, APPWRITE_DATABASE_ID, Query, safeDocId } from '@/shared/lib/appwrite';
import { dbDriver } from '@/shared/lib/dbDriver';

/**
 * 공유 CRUD 백엔드 어댑터 — Phase 3 보존 repo 일괄 전환용.
 * ([[Firestore_Appwrite_이관_단계별_계획서]] Phase 3)
 *
 * 저장 원시연산(loadAll/save/remove)만 제공. 각 repo의 파생 로직(list 필터·get·
 * 커스텀 메서드)은 그대로 두고 저장 접근만 이 백엔드로 위임한다.
 * 백엔드는 VITE_DB_DRIVER 로 Memory/Firestore/Appwrite 를 선택.
 *
 * 옵션:
 *  - jsonFields   : Appwrite 저장 시 JSON 문자열로 직렬화할 중첩 필드(배열-of-객체·record 등).
 *                   Appwrite 속성은 스칼라/스칼라배열만 가능하므로 중첩은 문자열로.
 *  - firestoreEncode/Decode : Firestore 전용 코덱(중첩 배열 제약 회피 — authRole/roleGroup).
 */
export { Query } from '@/shared/lib/appwrite';

export interface CrudBackend<T> {
  loadAll(): Promise<T[]>;
  /** 서버 사이드 쿼리 조건(Query.equal 등)을 백엔드에 직접 주입하여 조회 */
  loadWithQueries(queries?: string[]): Promise<T[]>;
  save(item: T): Promise<void>;
  remove(id: string): Promise<void>;
}

/** 같은 ID 문서가 이미 있어 `insert` 가 거부됐다. 호출부는 새 ID로 다시 시도한다. */
export class DocumentExistsError extends Error {
  constructor(public readonly coll: string, public readonly id: string) {
    super(`'${coll}/${id}' 문서가 이미 존재합니다.`);
    this.name = 'DocumentExistsError';
  }
}

export interface InsertableCrudBackend<T> extends CrudBackend<T> {
  /**
   * 신규 전용 저장. 같은 ID 문서가 있으면 덮어쓰지 않고 `DocumentExistsError` 를 던진다.
   * `save` 는 update→create 순서라 채번이 겹치면 남의 문서를 조용히 덮는다 — 순번 ID를
   * 클라이언트에서 만드는 컬렉션은 생성에 이것을 쓴다. 컬렉션이 없으면(404) 건너뛰지 않고 던진다.
   */
  insert(item: T): Promise<void>;
}

export interface CrudOpts<T> {
  coll: string;
  /** 안전 파싱: 성공 시 T, 실패 시 null(스킵). 불량 문서 1건이 전체를 깨지 않게. */
  parse: (raw: unknown) => T | null;
  /** 문서 $id 추출(예: item.id / item.code / `${a}__${b}`). */
  idOf: (item: T) => string;
  /** in-memory 폴백 시드. */
  seed: T[];
  /** Appwrite: JSON 직렬화할 중첩 필드명. */
  jsonFields?: string[];
  /** Appwrite: 저장 전 페이로드에서 제외할 클라이언트 전용 필드명. */
  stripFields?: string[];
  /** Firestore write 인코더(중첩 배열 코덱). */
  firestoreEncode?: (item: T) => unknown;
  /** Firestore read 디코더(파싱 전 적용). */
  firestoreDecode?: (raw: unknown) => unknown;
}

export function createCrudBackend<T>(opts: CrudOpts<T>): InsertableCrudBackend<T> {
  const { coll, parse, idOf, seed, jsonFields = [], stripFields = [], firestoreEncode, firestoreDecode } = opts;

  // ── Appwrite 직렬화(중첩 → JSON 문자열) ──
  const toRow = (item: T): Record<string, unknown> => {
    const row: Record<string, unknown> = { ...(item as Record<string, unknown>) };
    // Appwrite 시스템 메타데이터 및 클라이언트 임시 필드 제거
    delete row.$id;
    delete row.$createdAt;
    delete row.$updatedAt;
    delete row.$permissions;
    delete row.$databaseId;
    delete row.$collectionId;
    delete row.$sequence;

    for (const f of stripFields) {
      delete row[f];
    }

    for (const f of jsonFields) {
      const v = (item as Record<string, unknown>)[f];
      row[f] = v == null ? null : JSON.stringify(v);
    }
    return row;
  };
  const fromRow = (row: Record<string, unknown>): T | null => {
    const obj: Record<string, unknown> = { ...row };
    if (!obj.id && obj.$id) {
      obj.id = obj.$id;
    }
    for (const f of jsonFields) {
      const v = row[f];
      obj[f] = typeof v === 'string' && v ? JSON.parse(v) : (v ?? null);
    }
    return parse(obj);
  };

  if (dbDriver === 'appwrite') {
    const dbs = () => databases!;
    return {
      async loadAll() {
        return this.loadWithQueries([]);
      },
      async loadWithQueries(queries: string[] = []) {
        const out: T[] = [];
        const PAGE = 100;
        try {
          for (let offset = 0; ; offset += PAGE) {
            const fullQueries = [...queries, Query.limit(PAGE), Query.offset(offset)];
            const res = await dbs().listDocuments(APPWRITE_DATABASE_ID, coll, fullQueries);
            for (const row of res.documents as unknown as Record<string, unknown>[]) {
              const m = fromRow(row);
              if (m) out.push(m);
            }
            if (res.documents.length < PAGE) break;
          }
          return out;
        } catch (e: any) {
          if (e?.code === 404) {
            console.warn(`[crudBackend] Appwrite collection '${coll}' not found (404). Falling back to seed data.`);
            return seed.slice();
          }
          throw e;
        }
      },
      async save(item: T) {
        const id = safeDocId(idOf(item)); // 한글 등 규격 밖 자연키는 결정적 해시 $id 로 매핑
        const row = toRow(item);
        try {
          await dbs().updateDocument(APPWRITE_DATABASE_ID, coll, id, row);
        } catch (e: any) {
          if (e?.code === 404) {
            try {
              await dbs().createDocument(APPWRITE_DATABASE_ID, coll, id, row);
            } catch (createErr: any) {
              if (createErr?.code === 404) {
                console.warn(`[crudBackend] Appwrite collection '${coll}' not found (404) on create. Skipped remote write.`);
                return;
              }
              throw createErr;
            }
          } else {
            throw e;
          }
        }
      },
      async insert(item: T) {
        const id = safeDocId(idOf(item));
        try {
          await dbs().createDocument(APPWRITE_DATABASE_ID, coll, id, toRow(item));
        } catch (e: any) {
          if (e?.code === 409) throw new DocumentExistsError(coll, idOf(item));
          throw e;
        }
      },
      async remove(id: string) {
        try {
          await dbs().deleteDocument(APPWRITE_DATABASE_ID, coll, safeDocId(id));
        } catch (e: any) {
          if (e?.code === 404) {
            console.warn(`[crudBackend] Appwrite collection or doc '${coll}/${id}' not found (404) on remove.`);
            return;
          }
          throw e;
        }
      },
    };
  }

  if (dbDriver === 'firestore') {
    return {
      async loadAll() {
        const snap = await getDocs(collection(db!, coll));
        const out: T[] = [];
        for (const d of snap.docs) {
          const raw = firestoreDecode ? firestoreDecode(d.data()) : d.data();
          const m = parse(raw);
          if (m) out.push(m);
        }
        return out;
      },
      async loadWithQueries(_queries?: string[]) {
        return this.loadAll();
      },
      async save(item: T) {
        const payload = firestoreEncode ? firestoreEncode(item) : (item as Record<string, unknown>);
        await setDoc(doc(db!, coll, idOf(item)), payload as Record<string, unknown>);
      },
      async insert(item: T) {
        const ref = doc(db!, coll, idOf(item));
        const payload = firestoreEncode ? firestoreEncode(item) : (item as Record<string, unknown>);
        await runTransaction(db!, async (tx) => {
          if ((await tx.get(ref)).exists()) throw new DocumentExistsError(coll, idOf(item));
          tx.set(ref, payload as Record<string, unknown>);
        });
      },
      async remove(id: string) {
        await deleteDoc(doc(db!, coll, id));
      },
    };
  }

  // ── in-memory ──
  let mem: T[] = seed.slice();
  return {
    async loadAll() {
      return mem;
    },
    async loadWithQueries(_queries?: string[]) {
      return mem;
    },
    async save(item: T) {
      const i = mem.findIndex((m) => idOf(m) === idOf(item));
      if (i >= 0) mem[i] = item;
      else mem = [...mem, item];
    },
    async insert(item: T) {
      if (mem.some((m) => idOf(m) === idOf(item))) throw new DocumentExistsError(coll, idOf(item));
      mem = [...mem, item];
    },
    async remove(id: string) {
      mem = mem.filter((m) => idOf(m) !== id);
    },
  };
}
