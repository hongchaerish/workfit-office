import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  Search,
  Pin,
  Paperclip,
  Megaphone,
  PartyPopper,
  ScrollText,
  FileText,
  Eye,
  X,
  User,
  PenSquare,
  Download,
} from 'lucide-react';
import { boardRepo } from '@/data/board/board.repo';
import { DocumentExistsError } from '@/data/_backend/crudBackend';
import type { Post } from '@/domain/board/schema';
import { postDateLabel, postDateStamp, sortPostsForList } from '@/domain/board/rules';
import { ErrorNotice } from '@/shared/ui/ErrorNotice';
import { usePermission } from '@/features/auth/usePermission';
import { downloadFile } from '@/shared/lib/download';
import { fileStorage } from '@/shared/lib/storage';
import MobileCommonHeader from './MobileCommonHeader';

type BoardCategory = 'ALL' | 'notice' | 'event' | 'rule' | 'archive';
type PostAttachment = NonNullable<Post['attachedFiles']>[number];
type SelectedFile = { id: string; file: File };

const CATEGORIES: { id: BoardCategory; label: string; icon: string }[] = [
  { id: 'ALL', label: '전체', icon: '📋' },
  { id: 'notice', label: '공지사항', icon: '📢' },
  { id: 'event', label: '경조사', icon: '🎉' },
  { id: 'rule', label: '사내규정', icon: '📜' },
  { id: 'archive', label: '자료실', icon: '📁' },
];

export default function MobileBoardScreen() {
  const { canAction, user } = usePermission();
  const canCreate = canAction('S_GW_BOARD', 'create');

  const [posts, setPosts] = useState<Post[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  // 불러오기 실패를 '게시글이 없습니다'로 보이지 않게 따로 둔다.
  const [loadError, setLoadError] = useState('');
  const [formError, setFormError] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<BoardCategory>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedPost, setSelectedPost] = useState<Post | null>(null);

  // 글쓰기 모달 상태
  const [isWriteOpen, setIsWriteOpen] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newCategory, setNewCategory] = useState<Exclude<BoardCategory, 'ALL'>>('notice');
  const [newContent, setNewContent] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<SelectedFile[]>([]);
  const submittingRef = useRef(false);
  const uploadedFilesRef = useRef(new Map<string, PostAttachment>());
  const pendingPostIdRef = useRef<string | null>(null);

  const loadPosts = useCallback(async () => {
    setIsLoading(true);
    setLoadError('');
    try {
      const list = await boardRepo.list();
      setPosts(list);
    } catch (err) {
      console.error('Failed to load board posts:', err);
      setLoadError(`게시글을 불러오지 못했습니다.${err instanceof Error && err.message ? ` (${err.message})` : ''}`);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadPosts();
  }, [loadPosts]);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (submittingRef.current) return;
    const files = Array.from(e.currentTarget.files ?? []);
    setSelectedFiles((previous) => [
      ...previous,
      ...files.map((file) => ({ id: crypto.randomUUID(), file })),
    ]);
    e.currentTarget.value = '';
  };

  const handleCreatePost = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submittingRef.current) return;
    if (!canCreate || !user) {
      setFormError('게시글 작성 권한이 없습니다.');
      return;
    }
    if (!newTitle.trim() || !newContent.trim()) {
      setFormError('제목과 내용을 입력해주세요.');
      return;
    }
    setFormError('');
    submittingRef.current = true;
    setIsSubmitting(true);
    pendingPostIdRef.current ??= `POST_${Date.now()}`;
    try {
      const attachedFiles: PostAttachment[] = [];
      for (const selected of selectedFiles) {
        let attachment = uploadedFilesRef.current.get(selected.id);
        if (!attachment) {
          // Unique per selected file, so uploads never reuse an existing board file path.
          const path = `chat/board/${selected.id}_${selected.file.name}`;
          const url = await fileStorage.put(path, selected.file, {
            contentType: selected.file.type,
            filename: selected.file.name,
          });
          if (!url.trim()) throw new Error('첨부파일 주소를 받지 못했습니다.');
          attachment = {
            name: selected.file.name,
            size: (selected.file.size / (1024 * 1024)).toFixed(1) + ' MB',
            url,
            path,
          };
          // Keep completed uploads if a later upload or post save fails.
          uploadedFilesRef.current.set(selected.id, attachment);
        }
        attachedFiles.push(attachment);
      }
      const newPost: Post = {
        id: pendingPostIdRef.current,
        boardId: newCategory,
        title: newTitle.trim(),
        content: newContent.trim(),
        // PC와 같은 형식 — 표시는 '이름 직급', 본인 판별은 authorId.
        author: [user.name, user.position].filter(Boolean).join(' ') || '작성자',
        authorId: user.id,
        date: postDateStamp(),
        isPinned: false,
        views: 0,
        hasAttachment: attachedFiles.length > 0,
        attachedFiles: attachedFiles.length > 0 ? attachedFiles : undefined,
      };
      try {
        await boardRepo.create(newPost);
      } catch (err) {
        // 앞선 시도가 실제로는 저장됐는데 응답만 실패한 경우 — 같은 ID로 다시 누르면 여기로 온다.
        if (!(err instanceof DocumentExistsError)) throw err;
      }
      setNewTitle('');
      setNewContent('');
      setSelectedFiles([]);
      uploadedFilesRef.current.clear();
      pendingPostIdRef.current = null;
      setIsWriteOpen(false);
      await loadPosts();
    } catch (err) {
      console.error('게시글 등록 실패:', err);
      setFormError(`게시글 등록에 실패했습니다. ${err instanceof Error ? err.message : '다시 시도해 주세요.'}`);
    } finally {
      submittingRef.current = false;
      setIsSubmitting(false);
    }
  };

  // 카테고리 및 검색어 필터링
  const filteredPosts = useMemo(() => {
    let list = [...posts];

    // 카테고리 필터
    if (selectedCategory !== 'ALL') {
      list = list.filter((p) => p.boardId === selectedCategory);
    }

    // 검색어 필터
    const kw = searchQuery.trim().toLowerCase();
    if (kw) {
      list = list.filter(
        (p) =>
          p.title.toLowerCase().includes(kw) ||
          p.author.toLowerCase().includes(kw) ||
          (p.content && p.content.toLowerCase().includes(kw))
      );
    }

    // 정렬: 고정 글 먼저, 그다음 최신 글 (PC와 같은 규칙)
    return sortPostsForList(list);
  }, [posts, selectedCategory, searchQuery]);

  const getCategoryLabel = (boardId: string) => {
    switch (boardId) {
      case 'notice':
        return { label: '공지사항', icon: <Megaphone size={12} className="text-rose-500" />, badge: 'bg-rose-500/10 text-rose-600' };
      case 'event':
        return { label: '경조사', icon: <PartyPopper size={12} className="text-amber-500" />, badge: 'bg-amber-500/10 text-amber-600' };
      case 'rule':
        return { label: '사내규정', icon: <ScrollText size={12} className="text-blue-500" />, badge: 'bg-blue-500/10 text-blue-600' };
      case 'archive':
        return { label: '자료실', icon: <FileText size={12} className="text-teal" />, badge: 'bg-teal/10 text-teal' };
      default:
        return { label: '일반', icon: <FileText size={12} className="text-ink3" />, badge: 'bg-panel-alt text-ink2' };
    }
  };

  return (
    <div className="flex h-full flex-col select-none overflow-hidden" style={{ background: '#f2f8fc' }}>
      <MobileCommonHeader title="게시판" subtitle={`총 ${filteredPosts.length}건`} />

      {/* 1. 검색 바 */}
      <div className="bg-white px-3.5 py-2.5 border-b border-border/70 shrink-0 shadow-2xs">
        <div className="relative">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="게시글 제목, 작성자, 내용 검색…"
            className="h-9 w-full rounded-xl border border-border bg-panel px-3 pl-8.5 text-[12px] text-ink outline-none focus:border-teal placeholder:text-ink3"
          />
          <Search size={14} className="absolute left-2.5 top-2.5 text-ink3 pointer-events-none" />
        </div>
      </div>

      {/* 2. 카테고리 칩 필터 */}
      <div className="flex items-center gap-1.5 px-3.5 py-2 overflow-x-auto bg-white/70 border-b border-border/50 shrink-0 no-scrollbar">
        {CATEGORIES.map((cat) => (
          <button
            key={cat.id}
            type="button"
            onClick={() => setSelectedCategory(cat.id)}
            className={`flex shrink-0 items-center gap-1 rounded-xl px-2.5 py-1 text-[11px] font-bold transition-all ${
              selectedCategory === cat.id
                ? 'bg-teal text-white shadow-xs'
                : 'bg-white text-ink3 hover:bg-panel-alt border border-border/80'
            }`}
          >
            <span>{cat.icon}</span>
            <span>{cat.label}</span>
          </button>
        ))}
      </div>

      {/* 3. 게시글 목록 */}
      <div className="flex-1 overflow-y-auto px-3.5 py-3 space-y-2">
        {isLoading ? (
          <div className="py-16 text-center text-[12px] text-ink3">게시글을 불러오는 중입니다…</div>
        ) : loadError ? (
          <div className="flex flex-col items-center gap-2 py-10">
            <ErrorNotice message={loadError} />
            <button type="button" onClick={loadPosts} className="rounded-xl border border-border bg-white px-4 py-2 text-[12px] font-bold text-ink2">다시 불러오기</button>
          </div>
        ) : filteredPosts.length === 0 ? (
          <div className="py-16 text-center text-ink3 border border-dashed border-border/80 rounded-2xl bg-white/60">
            <FileText size={28} className="mx-auto mb-1.5 text-ink3/40" />
            <p className="text-[12px] font-bold text-ink">게시글이 없습니다.</p>
            <p className="text-[10.5px] text-ink3 mt-0.5">선택한 분류에 등록된 글이 없습니다.</p>
          </div>
        ) : (
          filteredPosts.map((post) => {
            const cat = getCategoryLabel(post.boardId);
            return (
              <div
                key={post.id}
                onClick={() => setSelectedPost(post)}
                className={`rounded-2xl border p-3.5 shadow-2xs transition-all cursor-pointer active:scale-98 space-y-1.5 ${
                  post.isPinned
                    ? 'border-rose-500/30 bg-rose-50/20 hover:border-rose-500/50'
                    : 'border-border/80 bg-white hover:border-teal/50'
                }`}
              >
                <div className="flex items-center justify-between gap-1.5">
                  <div className="flex items-center gap-1.5">
                    {post.isPinned && (
                      <span className="flex items-center gap-0.5 rounded bg-rose-500 px-1.5 py-0.2 text-[9.5px] font-bold text-white shadow-2xs">
                        <Pin size={10} />
                        <span>필독</span>
                      </span>
                    )}
                    <span className={`flex items-center gap-1 rounded px-1.5 py-0.2 text-[9.5px] font-bold ${cat.badge}`}>
                      {cat.icon}
                      <span>{cat.label}</span>
                    </span>
                  </div>

                  <span className="text-[10.5px] text-ink3 font-mono">
                    {postDateLabel(post.date)}
                  </span>
                </div>

                <h3 className="text-[13px] font-bold text-ink leading-snug line-clamp-2">
                  {post.title}
                </h3>

                <div className="flex items-center justify-between text-[11px] text-ink3 pt-1 border-t border-border/50">
                  <div className="flex items-center gap-1.5">
                    <User size={12} className="text-ink3" />
                    <span>{post.author}</span>
                  </div>

                  <div className="flex items-center gap-2 text-[10.5px]">
                    {post.hasAttachment && (
                      <span className="flex items-center gap-0.5 text-ink3">
                        <Paperclip size={11} />
                        <span>{post.attachedFiles?.length ?? 1}</span>
                      </span>
                    )}
                    <span className="flex items-center gap-0.5 text-ink3">
                      <Eye size={11} />
                      <span>{post.views ?? 0}</span>
                    </span>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* 4. 글쓰기 플로팅 버튼 (그룹권한관리 canAction('S_GW_BOARD', 'create') 보유자 전용) */}
      {canCreate && (
        <button
          type="button"
          onClick={() => setIsWriteOpen(true)}
          className="fixed bottom-6 right-5 z-40 flex items-center gap-1.5 rounded-full bg-teal px-4 py-3 text-[12.5px] font-bold text-white shadow-lg active:scale-95 transition-transform hover:opacity-95"
          title="새 글 작성"
        >
          <PenSquare size={16} />
          <span>글쓰기</span>
        </button>
      )}

      {/* 5. 새 글 작성 모달 */}
      {isWriteOpen && (
        <div className="fixed inset-0 z-50 flex flex-col bg-white animate-in fade-in slide-in-from-bottom duration-200">
          <header className="flex items-center justify-between border-b border-border px-3.5 py-3 shrink-0 bg-[#101830] text-white">
            <div className="flex items-center gap-1.5">
              <PenSquare size={15} className="text-teal-soft" />
              <span className="text-[13px] font-bold">새 게시글 작성</span>
            </div>
            <button
              type="button"
              onClick={() => setIsWriteOpen(false)}
              disabled={isSubmitting}
              className="grid h-8 w-8 place-items-center rounded-lg hover:bg-white/10 text-white"
            >
              <X size={18} />
            </button>
          </header>

          <form onSubmit={handleCreatePost} className="flex-1 flex flex-col overflow-hidden bg-panel">
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {/* 분류 선택 */}
              <div className="space-y-1.5">
                <label className="text-[11px] font-bold text-ink2">게시판 분류</label>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { id: 'notice' as const, label: '📢 공지사항' },
                    { id: 'event' as const, label: '🎉 경조사' },
                    { id: 'rule' as const, label: '📜 사내규정' },
                    { id: 'archive' as const, label: '📁 자료실' },
                  ].map((cat) => (
                    <button
                      key={cat.id}
                      type="button"
                      onClick={() => setNewCategory(cat.id)}
                      disabled={isSubmitting}
                      className={`rounded-xl py-2 text-[11.5px] font-bold transition-all border ${
                        newCategory === cat.id
                          ? 'border-teal bg-teal text-white shadow-2xs'
                          : 'border-border bg-white text-ink2 hover:bg-panel-alt'
                      }`}
                    >
                      {cat.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* 제목 */}
              <div className="space-y-1.5">
                <label className="text-[11px] font-bold text-ink2">제목</label>
                <input
                  type="text"
                  value={newTitle}
                  disabled={isSubmitting}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder="제목을 입력하세요"
                  required
                  className="w-full rounded-xl border border-border bg-white px-3 py-2 text-[13px] text-ink outline-none focus:border-teal"
                />
              </div>

              {/* 본문 */}
              <div className="space-y-1.5 flex-1 flex flex-col">
                <label className="text-[11px] font-bold text-ink2">내용</label>
                <textarea
                  value={newContent}
                  disabled={isSubmitting}
                  onChange={(e) => setNewContent(e.target.value)}
                  placeholder="내용을 상세히 입력하세요…"
                  rows={8}
                  required
                  className="w-full rounded-xl border border-border bg-white p-3 text-[12.5px] text-ink outline-none focus:border-teal resize-none"
                />
              </div>

              {/* 첨부파일 — 웹 게시판과 같은 스토리지/저장 형식 사용 */}
              <div className="space-y-1.5">
                <label htmlFor="mobile-board-files" className="flex items-center gap-1 text-[11px] font-bold text-ink2">
                  <Paperclip size={13} /> 첨부파일
                </label>
                <input
                  id="mobile-board-files"
                  type="file"
                  multiple
                  onChange={handleFileSelect}
                  disabled={isSubmitting}
                  className="block w-full text-[12px] text-ink2 file:mr-3 file:rounded-lg file:border file:border-border file:bg-white file:px-3 file:py-2 file:text-[12px] file:font-bold file:text-teal"
                />
                {selectedFiles.length > 0 && (
                  <ul className="space-y-1.5">
                    {selectedFiles.map((selected) => (
                      <li key={selected.id} className="flex items-center gap-2 rounded-lg border border-border/60 bg-white p-2 text-[12px]">
                        <span className="min-w-0 flex-1 break-all text-ink">{selected.file.name}</span>
                        <span className="shrink-0 text-[10px] text-ink3">{(selected.file.size / (1024 * 1024)).toFixed(1)} MB</span>
                        <button
                          type="button"
                          disabled={isSubmitting}
                          onClick={() => setSelectedFiles((previous) => previous.filter((item) => item.id !== selected.id))}
                          aria-label={`${selected.file.name} 첨부 해제`}
                          className="shrink-0 rounded-lg px-2 py-2 text-[11px] font-bold text-rose-500 disabled:opacity-50"
                        >
                          제거
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>

            {formError && <div className="px-3 pb-2"><ErrorNotice message={formError} /></div>}
            {/* 하단 저장 바 */}
            <div className="border-t border-border bg-white p-3 shrink-0 flex items-center gap-2">
              <button
                type="button"
                onClick={() => { setIsWriteOpen(false); setFormError(''); }}
                disabled={isSubmitting}
                className="flex-1 rounded-xl border border-border py-2.5 text-[12px] font-bold text-ink2 hover:bg-panel"
              >
                취소
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className="flex-2 rounded-xl bg-teal py-2.5 text-[12px] font-bold text-white shadow-xs hover:opacity-90 disabled:opacity-50"
              >
                {isSubmitting ? '등록 중…' : '게시글 등록'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* 6. 게시글 상세 모달 */}
      {selectedPost && (
        <div className="fixed inset-0 z-50 flex flex-col bg-white animate-in fade-in slide-in-from-bottom duration-200">
          {/* 모달 상단 헤더 */}
          <header className="flex items-center justify-between border-b border-border px-3 py-3 shrink-0" style={{ background: '#101830', color: '#fff' }}>
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-[13px] font-bold truncate">게시글 상세</span>
            </div>
            <button
              type="button"
              onClick={() => setSelectedPost(null)}
              className="grid h-8 w-8 place-items-center rounded-lg hover:bg-white/10 text-white transition-colors cursor-pointer"
            >
              <X size={18} />
            </button>
          </header>

          {/* 본문 스크롤 영역 */}
          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4" style={{ background: '#f2f8fc' }}>
            <div className="rounded-2xl border border-border/80 bg-white p-4 shadow-xs space-y-3">
              <div className="space-y-1.5 border-b border-border/60 pb-3">
                <div className="flex items-center gap-1.5">
                  {selectedPost.isPinned && (
                    <span className="rounded bg-rose-500 px-1.5 py-0.2 text-[9.5px] font-bold text-white">
                      필독 공지
                    </span>
                  )}
                  <span className="rounded bg-panel-alt px-1.5 py-0.2 text-[10px] font-bold text-ink2">
                    {getCategoryLabel(selectedPost.boardId).label}
                  </span>
                </div>

                <h1 className="text-[16px] font-black text-ink leading-snug">
                  {selectedPost.title}
                </h1>

                <div className="flex items-center justify-between text-[11px] text-ink3 pt-1">
                  <span>작성자: {selectedPost.author}</span>
                  <span>{postDateLabel(selectedPost.date)}</span>
                </div>
              </div>

              {/* 게시글 본문 */}
              <div className="text-[13px] text-ink2 leading-relaxed whitespace-pre-line py-2 min-h-[140px]">
                {selectedPost.content}
              </div>

              {/* 첨부파일 영역 */}
              {selectedPost.attachedFiles && selectedPost.attachedFiles.length > 0 && (
                <div className="rounded-xl border border-border bg-panel-alt/50 p-3 space-y-1.5">
                  <div className="flex items-center gap-1 text-[11.5px] font-bold text-ink">
                    <Paperclip size={13} className="text-teal" />
                    <span>첨부파일 ({selectedPost.attachedFiles.length}개)</span>
                  </div>
                  <div className="space-y-1">
                    {selectedPost.attachedFiles.map((file, idx) => (
                      <button
                        key={idx}
                        type="button"
                        disabled={!file.url?.trim()}
                        title={file.url?.trim() ? `${file.name} 다운로드` : '파일 주소가 없어 열 수 없습니다.'}
                        onClick={() => {
                          if (file.url?.trim()) void downloadFile(file.url, file.name);
                        }}
                        className="flex min-h-11 w-full items-center justify-between gap-3 rounded-lg bg-white p-2 border border-border/60 text-left text-[11.5px] enabled:hover:border-teal enabled:active:bg-teal-soft/20 disabled:opacity-60"
                      >
                        <span className="min-w-0 flex-1 truncate font-medium text-ink">{file.name}</span>
                        <span className="shrink-0 text-ink3 text-[10px]">{file.size}</span>
                        {file.url?.trim() ? (
                          <Download size={14} className="shrink-0 text-teal" aria-hidden="true" />
                        ) : (
                          <span className="shrink-0 text-[10px] text-ink3">파일 주소 없음</span>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
