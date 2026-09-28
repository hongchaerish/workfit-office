import { useState, useMemo, useEffect } from 'react';
import {
  Search,
  Pin,
  Paperclip,
  Pencil,
  Trash2,
  Megaphone,
  PartyPopper,
  ScrollText,
  FolderArchive,
  FileText,
  PenLine,
  ArrowLeft,
  Lightbulb,
} from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/app/auth/AuthProvider';
import { usePermission } from '@/features/auth/usePermission';
import { boardRepo } from '@/data/board/board.repo';
import { useBoardPosts } from '@/features/board/useBoardPosts';
import { BOARDS_SEED } from '@/data/seeds/board.seed';
import type { Post } from '@/domain/board/schema';
import { fileStorage } from '@/shared/lib/storage';
import { GwHead, GwSideNav, GwSplit } from '@/modules/gw/_gw';
import { Button } from '@/shared/ui/Button';

const BOARDS = BOARDS_SEED;

function getBoardIcon(boardId: string, size = 16, className = '') {
  switch (boardId) {
    case 'notice':
      return <Megaphone size={size} className={className} />;
    case 'event':
      return <PartyPopper size={size} className={className} />;
    case 'rule':
      return <ScrollText size={size} className={className} />;
    case 'archive':
      return <FolderArchive size={size} className={className} />;
    default:
      return <FileText size={size} className={className} />;
  }
}

export default function BoardScreen() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const boardParam = searchParams.get('board');
  const postIdParam = searchParams.get('postId');

  const { user } = useAuth();
  const { canAction } = usePermission();
  const canCreate = canAction('S_GW_BOARD', 'create');
  const canDelete = canAction('S_GW_BOARD', 'delete');
  const canUpdate = canAction('S_GW_BOARD', 'update');
  
  const { data: postsData = [], isLoading } = useBoardPosts();
  const [posts, setPosts] = useState<Post[]>([]);
  const [activeBoard, setActiveBoard] = useState<string>(boardParam || 'notice');
  const [viewMode, setViewMode] = useState<'list' | 'detail' | 'write' | 'edit'>('list');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedPostId, setSelectedPostId] = useState<string | null>(postIdParam);

  // 기존 첨부파일 목록 (수정 시 사용)
  const [existingAttachments, setExistingAttachments] = useState<{ name: string; size: string; url?: string }[]>([]);

  // 선택된 실제 파일 객체 목록 상태
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);

  // UI 표시용 첨부파일 목록 파생
  const writeAttachments = useMemo(() => {
    return selectedFiles.map((f) => ({
      name: f.name,
      size: (f.size / (1024 * 1024)).toFixed(1) + ' MB',
    }));
  }, [selectedFiles]);

  // 폼 상태 (글쓰기용)
  const [newPost, setNewPost] = useState({
    title: '',
    content: '',
    boardId: 'notice',
    isPinned: false,
  });

  // TanStack Query 데이터 동기화
  useEffect(() => {
    setPosts(postsData);
  }, [postsData]);

  // URL 파라미터 변경 감지 (도크 공지사항 클릭 등으로 진입 시)
  useEffect(() => {
    if (boardParam && BOARDS.some((b) => b.id === boardParam)) {
      setActiveBoard(boardParam);
    }
  }, [boardParam]);

  useEffect(() => {
    if (postIdParam && posts.length > 0) {
      const found = posts.find((p) => String(p.id) === String(postIdParam));
      if (found) {
        setActiveBoard(found.boardId);
        setSelectedPostId(String(found.id));
        setViewMode('detail');
      }
    }
  }, [postIdParam, posts]);

  const handleBackToList = () => {
    setSearchParams({ board: activeBoard });
    setSelectedPostId(null);
    setViewMode('list');
  };

  const activeBoardMeta = useMemo(() => {
    return BOARDS.find((b) => b.id === activeBoard) || BOARDS[0];
  }, [activeBoard]);

  const selectedPost = useMemo(() => {
    return posts.find((p) => String(p.id) === String(selectedPostId)) || null;
  }, [posts, selectedPostId]);

  const filteredPosts = useMemo(() => {
    let list = posts.filter((p) => p.boardId === activeBoard);
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(
        (p) =>
          p.title.toLowerCase().includes(q) ||
          p.content.toLowerCase().includes(q) ||
          p.author.toLowerCase().includes(q)
      );
    }
    // 고정글(isPinned) -> 최신순 정렬
    return [...list].sort((a, b) => {
      if (a.isPinned && !b.isPinned) return -1;
      if (!a.isPinned && b.isPinned) return 1;
      return new Date(b.date).getTime() - new Date(a.date).getTime();
    });
  }, [posts, activeBoard, searchQuery]);

  const handlePostClick = async (post: Post) => {
    const sessionKey = `read_post_${post.id}`;
    const alreadyRead = sessionStorage.getItem(sessionKey) === 'true';

    if (!alreadyRead) {
      sessionStorage.setItem(sessionKey, 'true');
      const updatedPost: Post = { ...post, views: post.views + 1 };
      try {
        // 백엔드 조회수 반영
        await boardRepo.save(updatedPost);
        setPosts((prev) =>
          prev.map((p) => (p.id === post.id ? updatedPost : p))
        );
      } catch (error) {
        console.error('Failed to update views in backend:', error);
      }
    }

    setSelectedPostId(String(post.id));
    setViewMode('detail');
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const list = Array.from(e.target.files);
      setSelectedFiles((prev) => [...prev, ...list]);
    }
  };

  const handleCreatePost = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) {
      alert('로그인이 필요한 서비스입니다.');
      return;
    }
    if (!newPost.title.trim() || !newPost.content.trim()) {
      alert('제목과 내용을 모두 입력해주세요.');
      return;
    }

    try {
      let attachedFilesData: { name: string; size: string; url?: string }[] = [];
      if (selectedFiles.length > 0) {
        attachedFilesData = await Promise.all(
          selectedFiles.map(async (file) => {
            const safePath = `chat/board/${Date.now()}_${file.name}`;
            const url = await fileStorage.put(safePath, file, {
              contentType: file.type,
              filename: file.name,
            });
            return {
              name: file.name,
              size: (file.size / (1024 * 1024)).toFixed(1) + ' MB',
              url,
            };
          })
        );
      }

      const created: Post = {
        id: Date.now().toString(),
        boardId: newPost.boardId,
        title: newPost.title,
        content: newPost.content,
        author: `${user.name} ${user.position}`,
        date: new Date().toISOString().split('T')[0],
        views: 0,
        isPinned: newPost.isPinned,
        hasAttachment: attachedFilesData.length > 0,
        attachedFiles: attachedFilesData.length > 0 ? attachedFilesData : undefined,
      };

      await boardRepo.save(created);
      setPosts((prev) => [created, ...prev]);
      setViewMode('list');
      setNewPost({
        title: '',
        content: '',
        boardId: activeBoard,
        isPinned: false,
      });
      setSelectedFiles([]);
    } catch (error) {
      console.error('Failed to save post:', error);
      alert('게시글 저장에 실패했습니다. 다시 시도해 주세요.');
    }
  };

  const handleDeletePost = async (postId: string) => {
    if (!confirm('정말 이 게시글을 삭제하시겠습니까?')) return;
    try {
      await boardRepo.remove(postId);
      setPosts((prev) => prev.filter((p) => p.id !== postId));
      setViewMode('list');
      setSelectedPostId(null);
    } catch (error) {
      console.error('Failed to delete post:', error);
      alert('게시글 삭제에 실패했습니다.');
    }
  };

  const handleStartEdit = (post: Post) => {
    setNewPost({
      title: post.title,
      content: post.content,
      boardId: post.boardId,
      isPinned: !!post.isPinned,
    });
    setExistingAttachments(post.attachedFiles ?? []);
    setSelectedFiles([]);
    setViewMode('edit');
  };

  const handleUpdatePost = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPost) return;
    if (!newPost.title.trim() || !newPost.content.trim()) {
      alert('제목과 내용을 모두 입력해주세요.');
      return;
    }

    try {
      let newAttachments: { name: string; size: string; url?: string }[] = [];
      if (selectedFiles.length > 0) {
        newAttachments = await Promise.all(
          selectedFiles.map(async (file) => {
            const safePath = `chat/board/${Date.now()}_${file.name}`;
            const url = await fileStorage.put(safePath, file, {
              contentType: file.type,
              filename: file.name,
            });
            return {
              name: file.name,
              size: (file.size / (1024 * 1024)).toFixed(1) + ' MB',
              url,
            };
          })
        );
      }

      const updatedAttachments = [...existingAttachments, ...newAttachments];

      const updated: Post = {
        ...selectedPost,
        title: newPost.title,
        content: newPost.content,
        boardId: newPost.boardId,
        isPinned: newPost.isPinned,
        hasAttachment: updatedAttachments.length > 0,
        attachedFiles: updatedAttachments.length > 0 ? updatedAttachments : undefined,
      };

      await boardRepo.save(updated);
      setPosts((prev) => prev.map((p) => (p.id === selectedPost.id ? updated : p)));
      setViewMode('detail');
      setSelectedFiles([]);
    } catch (error) {
      console.error('Failed to update post:', error);
      alert('게시글 수정에 실패했습니다. 다시 시도해 주세요.');
    }
  };

  const handleFileDownload = async (fileName: string, fileUrl?: string) => {
    if (!fileUrl) {
      const content = `Mock file download: ${fileName}\nDownloaded from WorkFit Board.`;
      const blob = new Blob([content], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      return;
    }

    try {
      const response = await fetch(fileUrl);
      if (!response.ok) throw new Error('Network response was not ok');
      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);
      
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(blobUrl);
    } catch (error) {
      console.error('File download failed, falling back to direct link:', error);
      const link = document.createElement('a');
      link.href = fileUrl;
      link.target = '_blank';
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  };

  return (
    <div className="mx-auto w-full max-w-[1500px] px-4 py-5 sm:px-6 sm:py-6">
      <GwHead
        icon="📢"
        name="사내 게시판"
        desc="공식 정보 및 사내 공지를 열람하고 공유합니다."
        right={
          canCreate && viewMode === 'list' ? (
            <Button
              onClick={() => {
                setNewPost({ ...newPost, boardId: activeBoard });
                setViewMode('write');
              }}
              variant="primary"
            >
              <PenLine size={14} />
              <span>새 글 쓰기</span>
            </Button>
          ) : undefined
        }
      />

      <GwSplit
        nav={
          <GwSideNav
            title="사내 게시판"
            desc="공식 정보 및 사내 공지를 열람합니다."
            items={BOARDS.map((b) => ({
              id: b.id,
              icon: b.id === 'notice' ? '📢' : b.id === 'event' ? '🎉' : b.id === 'rule' ? '📜' : '📁',
              label: b.name,
              badge: b.id === 'notice' ? '필독' : undefined,
              badgeTone: 'amber' as const,
            }))}
            activeId={activeBoard}
            onSelect={(id) => {
              setActiveBoard(id);
              setSearchQuery('');
              setViewMode('list');
            }}
          />
        }
      >
        {/* ── 우측 메인 컨텐츠 영역 ── */}
        <main className="flex-1 flex flex-col gap-4 rounded-xl border border-border bg-panel p-6 shadow-sm overflow-hidden min-w-0">
        
        {/* 1) 목록 뷰 */}
        {viewMode === 'list' && (
          <>
            <div className="flex flex-col gap-2 border-b border-border pb-4">
              <div className="flex items-center justify-between">
                <h1 className="text-base font-extrabold text-ink flex items-center gap-2">
                  <span>{getBoardIcon(activeBoardMeta.id, 18, 'text-teal')}</span>
                  <span>{activeBoardMeta.name}</span>
                </h1>
                {canCreate && (
                  <button
                    onClick={() => {
                      setNewPost({ ...newPost, boardId: activeBoard });
                      setViewMode('write');
                    }}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-teal px-4 py-2 text-[12px] font-bold text-white shadow-sm hover:opacity-90 transition-opacity"
                  >
                    <PenLine size={13} />
                    <span>새 글 쓰기</span>
                  </button>
                )}
              </div>
              <p className="text-[11.5px] text-ink3">{activeBoardMeta.desc}</p>
            </div>

            <div className="flex items-center justify-end gap-2">
              <div className="relative w-72">
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="제목, 내용 또는 작성자 검색"
                  className="h-9 w-full rounded-lg border border-border-hi bg-panel px-3.5 pr-8 text-[12px] outline-none focus:border-teal transition-colors"
                />
                <Search size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-ink3 pointer-events-none" />
              </div>
            </div>

            <div className="flex-1 overflow-auto rounded-lg border border-border bg-panel">
              <table className="w-full border-collapse text-left text-[12px]">
                <thead>
                  <tr className="border-b border-border bg-panel-alt/50 font-bold text-ink2">
                    <th className="p-3 w-14 text-center">번호</th>
                    <th className="p-3">제목</th>
                    <th className="p-3 w-28">작성자</th>
                    <th className="p-3 w-24">작성일</th>
                    <th className="p-3 w-16 text-center">조회</th>
                  </tr>
                </thead>
                <tbody>
                  {isLoading ? (
                    <tr>
                      <td colSpan={5} className="p-10 text-center text-ink3 animate-pulse">
                        데이터를 불러오는 중입니다...
                      </td>
                    </tr>
                  ) : filteredPosts.length > 0 ? (
                    filteredPosts.map((p, idx) => (
                      <tr
                        key={p.id}
                        onClick={() => handlePostClick(p)}
                        className={`border-b border-border hover:bg-panel-alt/30 cursor-pointer transition-colors ${
                          p.isPinned ? 'bg-teal-soft/20 border-teal/10' : ''
                        }`}
                      >
                        <td className="p-3 text-center">
                          {p.isPinned ? (
                            <span title="중요 공지" className="inline-flex items-center justify-center">
                              <Pin size={14} className="text-teal inline-block" />
                            </span>
                          ) : (
                            <span className="text-ink3">{filteredPosts.length - idx}</span>
                          )}
                        </td>
                        <td className="p-3 font-semibold text-ink flex items-center gap-1.5 min-w-0">
                          {p.isPinned && (
                            <span className="text-teal font-extrabold text-[10px] bg-teal-soft/50 border border-teal/30 rounded px-1.5 py-0.2 shrink-0">
                              중요
                            </span>
                          )}
                          <span className="truncate hover:text-teal transition-colors">{p.title}</span>
                          {p.hasAttachment && (
                            <span title="첨부파일 있음" className="inline-flex items-center">
                              <Paperclip size={12} className="opacity-75 shrink-0 text-ink3" />
                            </span>
                          )}
                        </td>
                        <td className="p-3 text-ink2 truncate">{p.author}</td>
                        <td className="p-3 text-ink3">{p.date}</td>
                        <td className="p-3 text-center text-ink3">{p.views}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={5} className="p-10 text-center text-ink3">
                        게시물이 존재하지 않습니다.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}

        {/* 2) 상세 조회 뷰 */}
        {viewMode === 'detail' && selectedPost && (
          <div className="flex-1 flex flex-col overflow-hidden">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <button
                onClick={handleBackToList}
                className="flex items-center gap-1.5 text-teal font-bold hover:underline"
              >
                <ArrowLeft size={14} /> <span>목록으로</span>
              </button>
              {user && selectedPost.author === `${user.name} ${user.position}` ? (
                <div className="flex gap-1.5">
                  {canUpdate && (
                    <button
                      type="button"
                      onClick={() => handleStartEdit(selectedPost)}
                      className="rounded-lg bg-panel-alt border border-border px-3 py-1.5 text-[11px] font-bold text-ink2 hover:bg-border/60 transition-colors flex items-center gap-1"
                    >
                      <Pencil size={12} /> 수정
                    </button>
                  )}
                  {canDelete && (
                    <button
                      type="button"
                      onClick={() => handleDeletePost(selectedPost.id)}
                      className="rounded-lg bg-panel-alt border border-border px-3 py-1.5 text-[11px] font-bold text-ink2 hover:bg-border/60 transition-colors flex items-center gap-1"
                    >
                      <Trash2 size={12} /> 삭제
                    </button>
                  )}
                </div>
              ) : (
                <div />
              )}
            </div>

            <div className="flex-1 overflow-y-auto pr-1 py-4 space-y-5">
              <div className="space-y-2 border-b border-border pb-3">
                <h2 className="text-[15px] font-extrabold text-ink leading-snug flex items-center gap-1.5">
                  {selectedPost.isPinned && <Pin size={16} className="text-teal shrink-0" />}
                  <span>{selectedPost.title}</span>
                </h2>
                <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-ink3">
                  <div className="flex items-center gap-3">
                    <span>작성자: <strong className="text-ink2">{selectedPost.author}</strong></span>
                    <span className="text-border">|</span>
                    <span>등록일: {selectedPost.date}</span>
                  </div>
                  <span>조회수: {selectedPost.views}</span>
                </div>
              </div>

              {/* 본문 내용 */}
              <div className="whitespace-pre-wrap leading-relaxed text-[13px] py-2 border-b border-border/60 pb-5 text-ink">
                {selectedPost.content}
              </div>

              {/* 연계 문서 바로가기 링크 */}
              {selectedPost.id === '1' && (
                <div className="rounded-lg border border-teal/20 bg-teal-soft/10 p-3.5 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Lightbulb size={15} className="text-teal shrink-0" />
                    <span className="text-[11.5px] font-semibold text-ink2">개정된 최신 규정집 본문은 문서관리에서 즉시 확인 가능합니다.</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => navigate('/gw/document?docId=1')}
                    className="text-[11px] font-bold text-white bg-teal px-3.5 py-1.5 rounded-lg hover:opacity-90 transition-opacity"
                  >
                    [취업규칙 확인]
                  </button>
                </div>
              )}

              {/* 첨부파일 영역 */}
              {selectedPost.hasAttachment && selectedPost.attachedFiles && (
                <div className="rounded-lg border border-border bg-panel-alt/30 p-3.5 space-y-2">
                  <div className="font-bold text-[11px] text-ink2 flex items-center gap-1">
                    <Paperclip size={13} /> 첨부파일 ({selectedPost.attachedFiles.length}개)
                  </div>
                  {selectedPost.attachedFiles.map((file, fidx) => (
                    <div
                      key={fidx}
                      onClick={() => handleFileDownload(file.name, file.url)}
                      className="flex items-center justify-between gap-3 text-[11.5px] hover:text-teal cursor-pointer"
                      title="클릭하여 다운로드"
                    >
                      <span className="underline">{file.name}</span>
                      <span className="text-[10px] text-ink3 font-mono">{file.size}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* 3) 글작성 / 수정 뷰 */}
        {(viewMode === 'write' || viewMode === 'edit') && (
          <form onSubmit={viewMode === 'edit' ? handleUpdatePost : handleCreatePost} className="flex-1 flex flex-col overflow-hidden">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <button
                type="button"
                onClick={() => setViewMode(viewMode === 'edit' ? 'detail' : 'list')}
                className="flex items-center gap-1 text-ink2 hover:text-ink font-semibold"
              >
                <ArrowLeft size={14} /> <span>{viewMode === 'edit' ? '수정 취소' : '작성 취소'}</span>
              </button>
              <span className="font-extrabold text-teal flex items-center gap-1">
                <Pencil size={15} />
                <span>{viewMode === 'edit' ? '게시글 수정' : '새 게시글 작성'}</span>
              </span>
            </div>

            <div className="flex-1 overflow-y-auto pr-1 py-4 space-y-4">
              <div className="flex flex-col gap-1.5">
                <label className="font-bold text-ink2">게시판 선택</label>
                <select
                  value={newPost.boardId}
                  onChange={(e) => setNewPost({ ...newPost, boardId: e.target.value })}
                  className="h-9.5 w-full max-w-xs rounded-lg border border-border-hi bg-panel px-3 outline-none focus:border-teal"
                >
                  {BOARDS.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="font-bold text-ink2">제목</label>
                <input
                  type="text"
                  value={newPost.title}
                  onChange={(e) => setNewPost({ ...newPost, title: e.target.value })}
                  placeholder="제목을 입력하세요"
                  required
                  className="h-9.5 w-full rounded-lg border border-border-hi bg-panel px-3.5 outline-none focus:border-teal"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="font-bold text-ink2">내용</label>
                <textarea
                  value={newPost.content}
                  onChange={(e) => setNewPost({ ...newPost, content: e.target.value })}
                  placeholder="본문 내용을 상세히 입력하세요"
                  required
                  rows={10}
                  className="w-full rounded-lg border border-border-hi bg-panel p-3.5 outline-none focus:border-teal resize-y leading-relaxed"
                />
              </div>

              {/* 기존 및 신규 첨부파일 영역 */}
              <div className="flex flex-col gap-1.5">
                <label className="font-bold text-ink2 flex items-center gap-1">
                  <Paperclip size={13} /> 첨부파일
                </label>

                {/* 기존 첨부파일 표시 (수정 모드일 때만) */}
                {viewMode === 'edit' && existingAttachments.length > 0 && (
                  <div className="mb-2">
                    <div className="text-[11px] font-bold text-ink3 mb-1">기존 첨부파일:</div>
                    <ul className="space-y-1">
                      {existingAttachments.map((f, idx) => (
                        <li key={idx} className="flex items-center justify-between text-[11.5px] text-ink bg-panel-alt px-2.5 py-1 rounded-md border border-border/50 opacity-90">
                          <span className="truncate flex items-center gap-1">
                            <Paperclip size={12} className="shrink-0 text-ink3" /> {f.name} ({f.size})
                          </span>
                          <button
                            type="button"
                            onClick={() => setExistingAttachments((prev) => prev.filter((_, i) => i !== idx))}
                            className="text-[11px] text-rose-500 hover:underline ml-2 shrink-0 font-bold"
                          >
                            제거
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <div className="border border-dashed border-border-hi hover:border-teal rounded-lg p-5 text-center cursor-pointer transition-colors bg-panel-alt/30 relative">
                  <input
                    type="file"
                    multiple
                    onChange={handleFileSelect}
                    className="absolute inset-0 opacity-0 cursor-pointer"
                  />
                  <div className="text-[12px] text-ink2 font-semibold">+ 파일을 드래그하거나 클릭하여 추가하세요</div>
                  <div className="text-[10px] text-ink3 mt-1">파일 용량 무제한 (모의 업로드)</div>
                </div>
                {writeAttachments.length > 0 && (
                  <ul className="mt-2 space-y-1">
                    {writeAttachments.map((f, idx) => (
                      <li key={idx} className="flex items-center justify-between text-[11.5px] text-ink bg-panel-alt px-2.5 py-1 rounded-md border border-border/50">
                        <span className="truncate flex items-center gap-1">
                          <Paperclip size={12} className="shrink-0 text-ink3" /> {f.name} ({f.size})
                        </span>
                        <button
                          type="button"
                          onClick={() => setSelectedFiles((prev) => prev.filter((_, i) => i !== idx))}
                          className="text-[11px] text-rose-500 hover:underline ml-2 shrink-0 font-bold"
                        >
                          삭제
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="flex flex-col gap-2 pt-1.5">
                <label className="flex items-center gap-2 cursor-pointer font-semibold text-ink2">
                  <input
                    type="checkbox"
                    checked={newPost.isPinned}
                    onChange={(e) => setNewPost({ ...newPost, isPinned: e.target.checked })}
                    className="h-4 w-4"
                  />
                  <span className="flex items-center gap-1">
                    <Pin size={13} className="text-teal" /> 중요 공지로 설정 (목록 최상단 고정)
                  </span>
                </label>
              </div>
            </div>

            {/* 작성/수정 풋터 */}
            <div className="border-t border-border pt-3.5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setViewMode(viewMode === 'edit' ? 'detail' : 'list')}
                className="rounded-lg border border-border-hi bg-panel px-4 py-2 font-bold text-ink2 hover:bg-panel-alt"
              >
                취소
              </button>
              <button
                type="submit"
                className="rounded-lg bg-teal px-5 py-2 font-bold text-white hover:opacity-90"
              >
                {viewMode === 'edit' ? '저장' : '등록'}
              </button>
            </div>
          </form>
        )}
      </main>
      </GwSplit>
    </div>
  );
}
