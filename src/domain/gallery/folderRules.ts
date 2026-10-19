import type { GalleryFolder } from './schema';

/**
 * 갤러리 폴더 규칙 — 경로(path) 계산과 삭제 범위 계산.
 * 폴더 계층은 parentId가 정본이고, path는 화면 표시용 사본이다.
 */

/** 상위 폴더 이름을 따라가며 경로를 만든다. 예: /행사/체육대회 */
export function buildFolderPath(
  folders: GalleryFolder[],
  folderId: string,
  rename?: { id: string; name: string },
): string {
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const names: string[] = [];
  const visited = new Set<string>();
  let cur = byId.get(folderId);
  while (cur && !visited.has(cur.id)) {
    visited.add(cur.id);
    names.unshift(rename && rename.id === cur.id ? rename.name : cur.name);
    cur = cur.parentId ? byId.get(cur.parentId) : undefined;
  }
  return `/${names.join('/')}`;
}

/** 폴더와 모든 하위 폴더 — 위에서 아래 순서(자기 자신이 첫 번째) */
export function collectFolderSubtree(folders: GalleryFolder[], folderId: string): GalleryFolder[] {
  const result: GalleryFolder[] = [];
  const visited = new Set<string>();
  const walk = (id: string) => {
    if (visited.has(id)) return;
    visited.add(id);
    const folder = folders.find((f) => f.id === id);
    if (folder) result.push(folder);
    for (const child of folders.filter((f) => f.parentId === id)) walk(child.id);
  };
  walk(folderId);
  return result;
}

/**
 * 이름 변경 시 다시 저장해야 할 폴더 목록.
 * 바뀐 폴더 자신(이름·경로)과, 경로가 달라지는 하위 폴더를 위에서 아래 순서로 돌려준다.
 */
export function planFolderRename(
  folders: GalleryFolder[],
  folderId: string,
  newName: string,
  newDescription: string,
): GalleryFolder[] {
  const target = folders.find((f) => f.id === folderId);
  if (!target) return [];
  const rename = { id: folderId, name: newName };
  const now = new Date().toISOString();
  return collectFolderSubtree(folders, folderId).flatMap((folder) => {
    const path = buildFolderPath(folders, folder.id, rename);
    if (folder.id === folderId) {
      return [{ ...folder, name: newName, description: newDescription, path, updatedAt: now }];
    }
    return folder.path === path ? [] : [{ ...folder, path, updatedAt: now }];
  });
}

/** 삭제할 폴더 ID — 아래에서 위 순서(가장 깊은 하위 폴더가 먼저, 선택한 폴더가 마지막) */
export function folderDeletionOrder(folders: GalleryFolder[], folderId: string): string[] {
  return collectFolderSubtree(folders, folderId).map((f) => f.id).reverse();
}
