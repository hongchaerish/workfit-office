import { useState } from 'react';
import { fileStorage } from '@/shared/lib/storage';

/**
 * 인감(도장) 이미지 업로드 훅.
 * 브라우저에서 300×300px 이내로 리사이즈(PNG) 후 파일 스토리지에 업로드하고 URL을 반환.
 * 저장 백엔드(Firebase / Garage(S3) / data URL 폴백)는 fileStorage 어댑터가 결정한다.
 */
export function useUploadSeal() {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload(userId: string, file: File): Promise<string> {
    setUploading(true);
    setError(null);
    try {
      // 이미지 리사이즈 (300×300 max, PNG 변환)
      const resized = await resizeImage(file, 300, 300);
      const blob = await dataUrlToBlob(resized);
      // 교체마다 새 경로를 사용해 이전 이미지 캐시와 기존 문서의 도장 덮어쓰기를 방지한다.
      const path = `seals/${userId}/seal-${crypto.randomUUID()}.png`;
      return await fileStorage.put(path, blob, {
        contentType: 'image/png',
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : '업로드에 실패했습니다.';
      setError(msg);
      throw e;
    } finally {
      setUploading(false);
    }
  }

  return { upload, uploading, error };
}

/** File → canvas 리사이즈 → base64 PNG */
function resizeImage(file: File, maxW: number, maxH: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const src = e.target?.result as string;
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxW / img.width, maxH / img.height);
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) { reject(new Error('Canvas 오류')); return; }
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/png'));
      };
      img.onerror = reject;
      img.src = src;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  return fetch(dataUrl).then((r) => r.blob());
}
