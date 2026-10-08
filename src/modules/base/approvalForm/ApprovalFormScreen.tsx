import React, { useState, useEffect, useRef } from 'react';
import {
  useApprovalForms,
  useUpsertApprovalForm,
  useRemoveApprovalForm,
  useApprovalFolders,
  useUpsertApprovalFolder,
  useRemoveApprovalFolder,
} from '@/features/gw/useApprovalForms';
import { useOrgTree } from '@/features/gw/useOrgTree';
import type { ApprovalForm, ApprovalFolder } from '@/domain/approvalForm/schema';
import { blankForm } from './utils';
import { ApprovalFormEditor } from './components/ApprovalFormEditor';
import { ApprovalFormCatalog } from './components/ApprovalFormCatalog';
import { Pencil, Trash2, Folder, Layers } from 'lucide-react';

export default function ApprovalFormScreen() {
  const { data: forms = [] } = useApprovalForms();
  const { data: folders = [] } = useApprovalFolders();
  const upsert = useUpsertApprovalForm();
  const remove = useRemoveApprovalForm();

  const upsertFolder = useUpsertApprovalFolder();
  const removeFolder = useRemoveApprovalFolder();

  const org = useOrgTree();

  // 현재 편집 중인 서식 (null 이면 카탈로그 목록 뷰, 객체면 전용 A4 위지윅 디자이너 뷰)
  const [sel, setSel] = useState<ApprovalForm | null>(null);
  const [msg, setMsg] = useState('');

  // 현재 선택된 폴더 필터 (null 이면 전체, 'root' 이면 루트 미지정 서식들)
  const [selFolderId, setSelFolderId] = useState<string | null>(null);

  // 폴더 & 서식 통합 트리뷰의 각 폴더별 열림/닫힘 아코디언 상태
  const [openFolders, setOpenFolders] = useState<Record<string, boolean>>({
    root: true, // 루트(미지정) 폴더는 기본적으로 열어둡니다.
  });
  const toggleFolder = (folderId: string) => {
    setOpenFolders((prev) => ({ ...prev, [folderId]: !prev[folderId] }));
  };

  // 폴더 컨텍스트 메뉴 상태
  const [folderMenu, setFolderMenu] = useState<{ x: number; y: number; folder: ApprovalFolder } | null>(null);
  const folderMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = () => setFolderMenu(null);
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, []);

  const save = async () => {
    if (!sel) return;
    const cleanCode = sel.code.trim();
    const cleanName = sel.name.trim();

    if (!cleanCode) {
      setMsg('오류: 서식 코드를 입력하세요.');
      return;
    }
    if (!cleanName) {
      setMsg('오류: 서식명을 입력하세요.');
      return;
    }

    // 1. 신규 등록이거나 코드 변경 시 중복 검사 (DB 무결성 보호)
    const isNew = !sel.id;
    const isCodeChanged = sel.id && sel.id !== cleanCode;
    if (isNew || isCodeChanged) {
      const exists = forms.some((f) => f.code.toLowerCase() === cleanCode.toLowerCase());
      if (exists) {
        setMsg(`오류: 서식 코드 '${cleanCode}'는 이미 사용 중입니다. 다른 코드를 지정하세요.`);
        return;
      }
    }

    // 2. 필드 키 중복 및 빈 키 검사
    const fieldKeys: string[] = [];
    for (let i = 0; i < sel.fields.length; i++) {
      const k = (sel.fields[i].key || '').trim();
      if (!k) {
        setMsg(`오류: ${i + 1}번째 필드의 키(Key)가 비어있습니다.`);
        return;
      }
      if (fieldKeys.includes(k)) {
        setMsg(`오류: 필드 키 '${k}'가 중복되었습니다. 각 필드는 고유한 영문 키를 가져야 합니다.`);
        return;
      }
      fieldKeys.push(k);
    }

    try {
      setMsg('저장 중입니다...');
      await upsert.mutateAsync({ ...sel, id: cleanCode, code: cleanCode, name: cleanName });
      setMsg('저장되었습니다 — 상신·인쇄에 즉시 반영됩니다.');
      setTimeout(() => {
        setSel(null);
        setMsg('');
      }, 600);
    } catch (err: any) {
      console.error('Failed to save approval form:', err);
      const errMsg = err?.message || '저장 처리 중 오류가 발생했습니다.';
      setMsg(`저장 실패: ${errMsg}`);
    }
  };

  const del = async (form: ApprovalForm) => {
    if (form.system) return;
    if (!confirm(`'${form.name}' 서식을 삭제하시겠습니까?`)) return;
    await remove.mutateAsync(form.id);
    if (sel?.id === form.id) setSel(null);
  };

  const duplicate = (form: ApprovalForm) => {
    setSel({ ...form, id: '', code: `${form.code}_사본`, name: `${form.name} 사본`, system: false, order: 99 });
    setMsg('');
  };

  // 원클릭 사용/중지 상태 토글
  const toggleActive = async (form: ApprovalForm) => {
    await upsert.mutateAsync({ ...form, active: !form.active });
  };

  // 새 서식 추가
  const handleAddNewForm = () => {
    setSel(blankForm(selFolderId && selFolderId !== 'root' ? selFolderId : null));
    setMsg('');
  };

  // 폴더 추가
  const addFolder = async () => {
    const name = prompt('새 폴더 이름을 입력하세요:');
    if (!name || !name.trim()) return;
    const id = `fld-${Date.now()}`;
    await upsertFolder.mutateAsync({ id, name: name.trim(), order: folders.length + 1 });
  };

  // 폴더 이름 변경
  const renameFolder = async (folder: ApprovalFolder) => {
    const name = prompt('변경할 폴더 이름을 입력하세요:', folder.name);
    if (!name || !name.trim() || name.trim() === folder.name) return;
    await upsertFolder.mutateAsync({ ...folder, name: name.trim() });
  };

  // 폴더 삭제 (내부 서식은 루트로 구출)
  const delFolder = async (folder: ApprovalFolder) => {
    if (!confirm(`'${folder.name}' 폴더를 삭제하시겠습니까?\n내부에 속해있던 서식은 최상위 루트로 이동됩니다.`)) return;
    await removeFolder.mutateAsync(folder.id);
    if (selFolderId === folder.id) setSelFolderId(null);
  };

  // 폴더 드래그 앤 드롭 정렬 상태
  const [draggedIdx, setDraggedIdx] = useState<number | null>(null);

  // 로컬 폴더 순서 상태 (드래그앤드롭 즉시 렌더용)
  const [localFolders, setLocalFolders] = useState<ApprovalFolder[]>([]);

  useEffect(() => {
    if (draggedIdx === null && JSON.stringify(localFolders) !== JSON.stringify(folders)) {
      setLocalFolders(folders);
    }
  }, [folders, draggedIdx, localFolders]);

  const handleDragStart = (idx: number) => {
    setDraggedIdx(idx);
  };

  const handleDragOver = (e: React.DragEvent, targetIdx: number) => {
    e.preventDefault();
    if (draggedIdx === null || draggedIdx === targetIdx) return;

    const nextFolders = [...localFolders];
    const draggedItem = nextFolders[draggedIdx];
    nextFolders.splice(draggedIdx, 1);
    nextFolders.splice(targetIdx, 0, draggedItem);

    setLocalFolders(nextFolders);
    setDraggedIdx(targetIdx);
  };

  const handleDragEnd = async () => {
    if (draggedIdx === null) return;
    setDraggedIdx(null);

    for (let i = 0; i < localFolders.length; i++) {
      const f = localFolders[i];
      const nextOrder = i + 1;
      if (f.order !== nextOrder) {
        await upsertFolder.mutateAsync({ ...f, order: nextOrder });
      }
    }
  };

  return (
    <div className="flex flex-col gap-3.5 relative">
      {/* 1. 편집 모드일 때: 전용 전체화면 위지윅 디자이너 */}
      {sel ? (
        <ApprovalFormEditor
          form={sel}
          folders={folders}
          org={org}
          onChange={setSel}
          onSave={save}
          onCancel={() => {
            setSel(null);
            setMsg('');
          }}
          onDelete={!sel.id ? undefined : () => del(sel)}
          onDuplicate={sel.id ? () => duplicate(sel) : undefined}
          saving={upsert.isPending}
          msg={msg}
        />
      ) : (
        /* 2. 목록 모드일 때: 서식 카탈로그 대시보드 뷰 (좌: 폴더 트리 260px, 우: 서식 그리드 1fr) */
        <>
          <div className="flex items-end justify-between">
            <div>
              <h1 className="text-xl font-extrabold tracking-tight text-ink">결재서식 관리</h1>
              <p className="mt-0.5 text-xs text-ink3">
                기준 정보 / 결재서식 관리 · 전사 전자결재 문서 양식 및 위지윅 A4 디자인 관리
              </p>
            </div>
            <button
              onClick={handleAddNewForm}
              className="rounded-lg bg-teal px-3.5 py-2 text-[12.5px] font-bold text-white shadow-xs hover:opacity-90 cursor-pointer"
            >
              + 새 서식 추가
            </button>
          </div>

          <div className="grid grid-cols-[260px_1fr] items-start gap-3.5">
            {/* 좌측: 폴더 탐색 트리 패널 */}
            <div className="flex flex-col overflow-hidden rounded-xl border border-border bg-panel">
              <div className="flex items-center justify-between border-b border-border px-3.5 py-2.5 text-[11.5px] font-bold text-ink2">
                <span className="flex items-center gap-1.5">
                  <Folder className="h-3.5 w-3.5 text-teal" />
                  <span>폴더 목록</span>
                </span>
                <button
                  type="button"
                  onClick={addFolder}
                  className="text-[10.5px] text-teal hover:underline font-bold cursor-pointer"
                >
                  + 폴더 추가
                </button>
              </div>

              <div className="p-2 space-y-1 overflow-y-auto max-h-[calc(75vh/var(--font-scale,1))]">
                {/* 0. 전체 서식 뷰 버튼 */}
                <button
                  type="button"
                  onClick={() => setSelFolderId(null)}
                  className={`flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-[12px] font-bold transition-colors cursor-pointer ${
                    selFolderId === null
                      ? 'bg-teal-soft text-teal'
                      : 'text-ink2 hover:bg-panel-alt'
                  }`}
                >
                  <span className="flex items-center gap-1.5">
                    <Layers className="h-3.5 w-3.5" />
                    <span>전체 서식</span>
                  </span>
                  <span className="rounded-full bg-panel px-1.5 py-0.2 text-[10px] font-bold border border-border/60">
                    {forms.length}
                  </span>
                </button>

                <div className="my-1 border-t border-border/60" />

                {/* 1. 루트(미지정) 폴더 */}
                <div className="space-y-0.5">
                  <button
                    type="button"
                    onClick={() => {
                      toggleFolder('root');
                      setSelFolderId('root');
                    }}
                    className={`flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-[12px] font-bold transition-colors cursor-pointer ${
                      selFolderId === 'root' ? 'bg-teal-soft text-teal' : 'text-ink2 hover:bg-panel-alt'
                    }`}
                  >
                    <span className="flex items-center gap-1.5">
                      <span className="text-[9px] text-ink3 w-3 select-none">
                        {openFolders['root'] ? '▼' : '▶'}
                      </span>
                      <span>📁 루트 (미지정)</span>
                    </span>
                    <span className="text-[10.5px] opacity-60 font-normal">
                      {forms.filter((f) => !f.folderId).length}
                    </span>
                  </button>

                  {openFolders['root'] && (
                    <div className="pl-4 border-l border-border/60 ml-3.5 my-1 space-y-0.5">
                      {forms
                        .filter((f) => !f.folderId)
                        .map((f) => (
                          <button
                            key={f.id}
                            type="button"
                            onClick={() => {
                              setSel(f);
                              setMsg('');
                            }}
                            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-ink hover:bg-panel-alt transition-colors cursor-pointer"
                          >
                            <span className="text-[13px]">{f.icon || '📄'}</span>
                            <span className="min-w-0 flex-1 truncate text-[11.5px]">
                              {f.name}
                              {f.system && (
                                <span className="ml-1 rounded bg-ink3/10 px-1 py-0.2 text-[8px] font-bold text-ink3">
                                  기본
                                </span>
                              )}
                              {!f.active && (
                                <span className="ml-1 text-[8.5px] text-red-500 font-bold">
                                  중지
                                </span>
                              )}
                            </span>
                          </button>
                        ))}
                      {forms.filter((f) => !f.folderId).length === 0 && (
                        <div className="py-1.5 pl-2 text-[10.5px] text-ink3">등록된 서식 없음</div>
                      )}
                    </div>
                  )}
                </div>

                <div className="my-1 border-t border-border-hi" />

                {/* 2. 각 폴더 트리 */}
                {localFolders.map((f, idx) => {
                  const folderForms = forms.filter((form) => form.folderId === f.id);
                  const isOpen = !!openFolders[f.id];
                  const isSelected = selFolderId === f.id;

                  return (
                    <div key={f.id} className="space-y-0.5">
                      <button
                        type="button"
                        draggable
                        onDragStart={() => handleDragStart(idx)}
                        onDragOver={(e) => handleDragOver(e, idx)}
                        onDragEnd={handleDragEnd}
                        onClick={() => {
                          toggleFolder(f.id);
                          setSelFolderId(f.id);
                        }}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          const zoom =
                            parseFloat(
                              window
                                .getComputedStyle(document.documentElement)
                                .getPropertyValue('--font-scale') || '1.48'
                            ) || 1;
                          setFolderMenu({ x: e.clientX / zoom, y: e.clientY / zoom, folder: f });
                        }}
                        className={`flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-[12px] font-bold cursor-grab active:cursor-grabbing transition-all ${
                          draggedIdx === idx
                            ? 'opacity-30 border border-dashed border-teal scale-95'
                            : isSelected
                            ? 'bg-teal-soft text-teal'
                            : 'text-ink2 hover:bg-panel-alt'
                        }`}
                      >
                        <span className="flex items-center gap-1.5 truncate">
                          <span className="text-[9px] text-ink3 w-3 select-none">
                            {isOpen ? '▼' : '▶'}
                          </span>
                          <span className="truncate">📁 {f.name}</span>
                        </span>
                        <span className="text-[10.5px] opacity-60 font-normal">
                          {folderForms.length}
                        </span>
                      </button>

                      {isOpen && (
                        <div className="pl-4 border-l border-border/60 ml-3.5 my-1 space-y-0.5">
                          {folderForms.map((formItem) => (
                            <button
                              key={formItem.id}
                              type="button"
                              onClick={() => {
                                setSel(formItem);
                                setMsg('');
                              }}
                              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-ink hover:bg-panel-alt transition-colors cursor-pointer"
                            >
                              <span className="text-[13px]">{formItem.icon || '📄'}</span>
                              <span className="min-w-0 flex-1 truncate text-[11.5px]">
                                {formItem.name}
                                {formItem.system && (
                                  <span className="ml-1 rounded bg-ink3/10 px-1 py-0.2 text-[8px] font-bold text-ink3">
                                    기본
                                  </span>
                                )}
                                {!formItem.active && (
                                  <span className="ml-1 text-[8.5px] text-red-500 font-bold">
                                    중지
                                  </span>
                                )}
                              </span>
                            </button>
                          ))}
                          {folderForms.length === 0 && (
                            <div className="py-1.5 pl-2 text-[10.5px] text-ink3">등록된 서식 없음</div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* 우측: 서식 카탈로그 대시보드 (카드 그리드, 검색, 정렬, 원클릭 토글) */}
            <ApprovalFormCatalog
              forms={forms}
              folders={folders}
              selFolderId={selFolderId}
              onSelectForm={(formItem) => {
                setSel(formItem);
                setMsg('');
              }}
              onAddNewForm={handleAddNewForm}
              onToggleActive={toggleActive}
              onDuplicate={duplicate}
              onDelete={del}
            />
          </div>
        </>
      )}

      {/* 폴더 컨텍스트 우클릭 메뉴 */}
      {folderMenu && (
        <div
          ref={folderMenuRef}
          className="fixed z-[100] w-32 overflow-hidden rounded-lg border border-border bg-panel py-1 shadow-lg"
          style={{ top: folderMenu.y, left: folderMenu.x }}
        >
          <button
            onClick={() => renameFolder(folderMenu.folder)}
            className="flex items-center gap-1.5 w-full px-3 py-2 text-left text-[12px] text-ink hover:bg-panel-alt transition-colors cursor-pointer"
          >
            <Pencil className="h-3.5 w-3.5" />
            <span>이름 변경</span>
          </button>
          <button
            onClick={() => delFolder(folderMenu.folder)}
            className="flex items-center gap-1.5 w-full px-3 py-2 text-left text-[12px] text-danger hover:bg-panel-alt transition-colors cursor-pointer"
          >
            <Trash2 className="h-3.5 w-3.5" />
            <span>폴더 삭제</span>
          </button>
        </div>
      )}
    </div>
  );
}
