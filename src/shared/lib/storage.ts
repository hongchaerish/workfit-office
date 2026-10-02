import {
  ref,
  uploadBytes,
  getDownloadURL,
  deleteObject,
  type FirebaseStorage,
} from 'firebase/storage';
import { Storage as AppwriteStorage } from 'appwrite';
import { client as appwriteClient, isAppwriteConfigured, safeDocId } from '@/shared/lib/appwrite';
import { storage as firebaseStorage, isFirebaseConfigured } from '@/shared/lib/firebase';

/**
 * 파일 스토리지 추상화 계층 (Storage Adapter).
 *
 * [[DB_이관_대비_설계원칙.md]] 원칙 1을 파일 저장소에 적용한 것:
 * 앱 전체에서 `firebase/storage` 를 import 하는 유일한 곳은 이 파일이다.
 * repo·features·UI 는 `fileStorage.put()/remove()` 만 호출하고,
 * 실제 백엔드(Firebase / Garage(S3) / data URL 폴백)는 이 파일에서만 안다.
 *
 * 백엔드 교체 = 이 파일의 어댑터 구현 하나만 바꾸는 작업.
 * 선택은 환경변수 VITE_STORAGE_DRIVER = "s3" | "firebase" | "dataurl" 로.
 * (미지정 시: Firebase 설정돼 있으면 firebase, 아니면 dataurl 폴백 — 기존 동작 보존)
 */

export interface PutOptions {
  /** 저장/전송 Content-Type (미지정 시 Blob.type) */
  contentType?: string;
  /** 다운로드 시 보존할 원본 파일명 (Content-Disposition; 한글 등 비ASCII 대응) */
  filename?: string;
}

export interface StorageAdapter {
  /** 파일을 주어진 경로(path)에 저장하고 접근 가능한 URL을 반환. */
  put(path: string, data: Blob, opts?: PutOptions): Promise<string>;
  /** 경로의 파일을 삭제(best-effort). 미지원/미존재는 조용히 무시. */
  remove(path: string): Promise<void>;
  /** 파일 접근 임시 서명 URL 발급 (disposition: 'inline' | 'attachment') */
  getSignUrl(path: string, disposition?: 'inline' | 'attachment'): Promise<string>;
}

/** Content-Disposition 헤더값 생성(원본 파일명 보존). */
function contentDisposition(filename?: string): string | undefined {
  if (!filename) return undefined;
  return `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

/** Blob → data URL (폴백/미리보기용). */
function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

// ─────────────────────────────────────────────────────────────
// 1) Firebase Storage 어댑터 (현행 기본)
// ─────────────────────────────────────────────────────────────
class FirebaseStorageAdapter implements StorageAdapter {
  constructor(private readonly storage: FirebaseStorage) {}

  async put(path: string, data: Blob, opts?: PutOptions): Promise<string> {
    const r = ref(this.storage, path);
    await uploadBytes(r, data, {
      contentType: opts?.contentType || data.type || 'application/octet-stream',
      ...(contentDisposition(opts?.filename)
        ? { contentDisposition: contentDisposition(opts?.filename) }
        : {}),
    });
    return getDownloadURL(r);
  }

  async remove(path: string): Promise<void> {
    try {
      await deleteObject(ref(this.storage, path));
    } catch {
      /* 이전 파일 없음 등 무시 */
    }
  }

  async getSignUrl(path: string, _disposition?: 'inline' | 'attachment'): Promise<string> {
    const r = ref(this.storage, path);
    return getDownloadURL(r);
  }
}

// ─────────────────────────────────────────────────────────────
// 2) Garage(S3 호환) 어댑터 — presigned URL 방식
//    브라우저는 자격증명을 갖지 않는다. DMZ의 서명 API가 presigned URL을 발급하고,
//    브라우저는 그 URL로 직접 업로드/다운로드한다. (파일서버_이관_제안서 §4.2)
//    서명 API 엔드포인트: VITE_STORAGE_SIGN_URL
//
//    [인증] (임시) 서명 API의 Bearer 토큰 게이트에 VITE_STORAGE_SIGN_TOKEN 을 전달.
//      ⚠️ VITE_ 값은 번들에 노출되므로 강한 보안은 아니다(현행 Firebase 공개 write와 동급).
//      TODO(실 인증): 앱이 Firebase Auth(VITE_AUTH_ENABLED)를 켜는 시점에,
//        여기서 Firebase ID토큰을 Authorization 으로 보내고 서명 API는 Admin SDK로 검증하도록 교체.
// ─────────────────────────────────────────────────────────────
class S3StorageAdapter implements StorageAdapter {
  constructor(private readonly signUrl: string, private readonly token?: string) {}

  /** 서명 API 호출용 헤더(선택적 Bearer 토큰 포함). */
  private signHeaders(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
    };
  }

  async put(path: string, data: Blob, opts?: PutOptions): Promise<string> {
    const contentType = opts?.contentType || data.type || 'application/octet-stream';
    // S3 호환 서버(Garage 등)와의 서명(Signature V4) 생성 및 경로 호환성을 위해 
    // 한글 등 non-ASCII 문자가 들어간 경로 세그먼트를 URL 인코딩(encodeURIComponent)합니다.
    const safePath = path.split('/').map(segment => encodeURIComponent(segment)).join('/');
    
    // 1) 서명 API에 presigned PUT URL 요청 (앱 세션 검증은 서명 API 측에서)
    const signRes = await fetch(this.signUrl, {
      method: 'POST',
      headers: this.signHeaders(),
      credentials: 'include',
      body: JSON.stringify({
        op: 'put',
        path: safePath,
        contentType,
        // ⚠️ 파일명은 원본 그대로 보낸다. 서명 API가 Content-Disposition의
        //   RFC 5987(`filename*=UTF-8''…`) 인코딩을 담당하므로 여기서 미리
        //   encodeURIComponent 하면 `%` → `%25` 이중 인코딩되어 한글 파일명이
        //   `%EA%B2%B0…` 리터럴로 저장·다운로드된다.
        filename: opts?.filename,
      }),
    });
    if (!signRes.ok) {
      const errBody = await signRes.text().catch(() => '');
      console.error('Sign API Error Response:', errBody);
      throw new Error(`서명 URL 발급 실패 (${signRes.status}): ${errBody}`);
    }
    // headers: 서명에 포함된 헤더(Content-Type, 필요시 Content-Disposition)를 그대로 보내야 함.
    const { putUrl, headers, getUrl } = (await signRes.json()) as {
      putUrl: string;
      headers?: Record<string, string>;
      getUrl: string;
    };

    // 2) presigned URL로 직접 업로드 (서명 API가 지정한 헤더 그대로 전송)
    const putRes = await fetch(putUrl, {
      method: 'PUT',
      headers: headers ?? { 'Content-Type': contentType },
      body: data,
    });
    if (!putRes.ok) throw new Error(`업로드 실패 (${putRes.status})`);
    return getUrl;
  }

  async remove(path: string): Promise<void> {
    try {
      const safePath = path.split('/').map(segment => encodeURIComponent(segment)).join('/');
      await fetch(this.signUrl, {
        method: 'POST',
        headers: this.signHeaders(),
        credentials: 'include',
        body: JSON.stringify({ op: 'delete', path: safePath }),
      });
    } catch {
      /* best-effort */
    }
  }

  async getSignUrl(path: string, disposition?: 'inline' | 'attachment'): Promise<string> {
    const safePath = path.split('/').map(segment => encodeURIComponent(segment)).join('/');
    const signRes = await fetch(this.signUrl, {
      method: 'POST',
      headers: this.signHeaders(),
      credentials: 'include',
      body: JSON.stringify({
        op: 'get',
        path: safePath,
        disposition: disposition || 'inline',
      }),
    });
    if (!signRes.ok) {
      const errBody = await signRes.text().catch(() => '');
      console.error('Sign API Error Response:', errBody);
      throw new Error(`서명 URL 발급 실패 (${signRes.status}): ${errBody}`);
    }
    const { getUrl } = (await signRes.json()) as { getUrl: string };
    return getUrl;
  }
}

// ─────────────────────────────────────────────────────────────
// 3) Appwrite Storage 어댑터
//
//    DB가 Appwrite면 파일도 같은 곳에 두는 게 맞다. 별도 인프라가 필요 없고 URL 수명이
//    프로젝트와 함께 간다.
//
//    ⚠ 브라우저는 프로젝트 ID만 가진 익명 클라이언트라 **버킷 권한이 열려 있어야** 올릴 수
//      있다(`scripts/appwrite-storage.ts` 가 그렇게 만든다). 컬렉션의 `Any` 권한과 같은
//      부채이고, Appwrite Auth 도입 때 함께 좁힌다.
// ─────────────────────────────────────────────────────────────
class AppwriteStorageAdapter implements StorageAdapter {
  private readonly storage: AppwriteStorage;

  constructor(private readonly bucketId: string, client: NonNullable<typeof appwriteClient>) {
    this.storage = new AppwriteStorage(client);
  }

  /**
   * 경로를 파일 ID로 쓴다. Appwrite 파일 ID는 36자 이내 영숫자·`_`·`-` 만 되고 `/` 를
   * 못 쓰므로 경로를 안전한 키로 접어 넣는다(`safeDocId` 와 같은 규칙).
   */
  private fileId(path: string): string {
    return safeDocId(path);
  }

  async put(path: string, data: Blob, opts?: PutOptions): Promise<string> {
    const id = this.fileId(path);
    const name = opts?.filename || 'file';
    const file = data instanceof File ? data : new File([data], name, { type: opts?.contentType || data.type });
    // 같은 경로로 다시 올리면 기존 파일을 지우고 새로 넣는다(덮어쓰기 API가 없다).
    try {
      await this.storage.deleteFile(this.bucketId, id);
    } catch {
      /* 없으면 그만 */
    }
    await this.storage.createFile(this.bucketId, id, file);
    return this.storage.getFileView(this.bucketId, id).toString();
  }

  async remove(path: string): Promise<void> {
    try {
      await this.storage.deleteFile(this.bucketId, this.fileId(path));
    } catch {
      /* 이미 없음 등 무시 */
    }
  }

  async getSignUrl(path: string, disposition?: 'inline' | 'attachment'): Promise<string> {
    const id = this.fileId(path);
    return disposition === 'attachment'
      ? this.storage.getFileDownload(this.bucketId, id).toString()
      : this.storage.getFileView(this.bucketId, id).toString();
  }
}

// ─────────────────────────────────────────────────────────────
// 4) data URL 폴백 어댑터 — 백엔드 미설정(데모/오프라인)
//    저장하지 않고 base64 data URL을 반환(세션 한정 미리보기).
// ─────────────────────────────────────────────────────────────
class DataUrlAdapter implements StorageAdapter {
  async put(_path: string, data: Blob): Promise<string> {
    return blobToDataUrl(data);
  }
  async remove(): Promise<void> {
    /* 저장하지 않으므로 no-op */
  }
  async getSignUrl(path: string, _disposition?: 'inline' | 'attachment'): Promise<string> {
    return path;
  }
}

// ─────────────────────────────────────────────────────────────
// 활성 어댑터 선택
// ─────────────────────────────────────────────────────────────
type Driver = 's3' | 'firebase' | 'appwrite' | 'dataurl';

// 테스트(node)에서는 import.meta.env 가 통째로 undefined 라 바로 읽으면 모듈 로드에서 터진다(dbDriver.ts·appwrite.ts 와 같은 가드).
const env: Record<string, string | undefined> = import.meta.env ?? {};
const APPWRITE_BUCKET = env.VITE_APPWRITE_BUCKET_ID ?? 'workfiles';

/**
 * 기본 드라이버 선택 순서: Firebase → Appwrite → data URL.
 *
 * **data URL 폴백은 저장이 아니다.** base64 문자열을 그대로 돌려주는데, 그걸 URL 칸에
 * 넣으면 문서 크기 제한(예: `workTaskFiles.url` 512자)을 그냥 넘겨 저장이 거부된다.
 * Appwrite가 붙어 있으면 반드시 그쪽을 쓴다.
 */
function selectAdapter(): StorageAdapter {
  const driver = (env.VITE_STORAGE_DRIVER as Driver | undefined)
    ?? (isFirebaseConfigured ? 'firebase' : isAppwriteConfigured ? 'appwrite' : 'dataurl');

  switch (driver) {
    case 'appwrite':
      if (isAppwriteConfigured && appwriteClient) return new AppwriteStorageAdapter(APPWRITE_BUCKET, appwriteClient);
      console.warn('[storage] VITE_STORAGE_DRIVER=appwrite 이지만 Appwrite 미설정 → data URL 폴백');
      return new DataUrlAdapter();
    case 's3': {
      const signUrl = env.VITE_STORAGE_SIGN_URL;
      const signToken = env.VITE_STORAGE_SIGN_TOKEN;
      if (signUrl) return new S3StorageAdapter(signUrl, signToken);
      console.warn('[storage] VITE_STORAGE_DRIVER=s3 이지만 VITE_STORAGE_SIGN_URL 미설정 → data URL 폴백');
      return new DataUrlAdapter();
    }
    case 'firebase':
      if (isFirebaseConfigured && firebaseStorage) return new FirebaseStorageAdapter(firebaseStorage);
      return new DataUrlAdapter();
    default:
      return new DataUrlAdapter();
  }
}

/** 앱 전역 파일 스토리지. repo/훅은 이 객체의 put/remove 만 사용한다. */
export const fileStorage: StorageAdapter = selectAdapter();
