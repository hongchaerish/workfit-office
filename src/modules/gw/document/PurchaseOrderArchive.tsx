import { useEffect, useMemo, useRef, useState } from 'react';
import { Download, FileCheck2, FileText, Loader2, PackageCheck, Search, Upload } from 'lucide-react';
import { Modal } from '@/shared/ui/Modal';
import { downloadFile } from '@/shared/lib/download';
import { exportElementToPdf } from '@/shared/lib/pdf';
import type { ApprovalDoc } from '@/domain/approvalDoc/schema';
import {
  canUploadPoReply,
  completedDateOf,
  filterPurchaseOrders,
  poPdfFileName,
  type PoArchiveQuery,
  type PoReply,
  type PoReplyFilter,
  type PoViewer,
} from '@/domain/poArchive/schema';
import { usePoReplies, usePurchaseOrderArchive, useUploadPoReply } from '@/features/poArchive/usePoArchive';
import { poReplyRepo } from '@/data/poArchive/poReply.repo';
import { ApprovalDocumentView } from '@/modules/gw/approval/ApprovalDocumentView';

const REPLY_FILTERS: { key: PoReplyFilter; label: string }[] = [
  { key: 'all', label: '전체' },
  { key: 'pending', label: '회신 대기' },
  { key: 'replied', label: '회신 완료' },
];

/** 회신 문서로 받는 형식 — 스캔본·사진·PDF. */
const REPLY_ACCEPT = '.pdf,.jpg,.jpeg,.png,.tif,.tiff';

/**
 * 발주서 보관함 — 결재 완료된 발주서가 자동으로 쌓이는 목록.
 * 한 줄: 제목 · 완료일자 | PDF 다운로드 | 회신 문서(거래처 직인본) 업로드·다운로드.
 */
export function PurchaseOrderArchive({
  me,
  isManager,
}: {
  me: { id: string; name: string; dept: string };
  isManager: boolean;
}) {
  const viewer = useMemo(
    () => (me.id === 'guest' ? null : { userId: me.id, deptName: me.dept, isManager }),
    [me.id, me.dept, isManager],
  );
  const { docs, isLoading } = usePurchaseOrderArchive(viewer);
  const { data: replies = [] } = usePoReplies();
  const upload = useUploadPoReply();

  const replyByDoc = useMemo(() => new Map(replies.map((r) => [r.docId, r])), [replies]);
  const [query, setQuery] = useState<PoArchiveQuery>({ keyword: '', from: '', to: '', reply: 'all' });
  const rows = useMemo(
    () => filterPurchaseOrders(docs, query, (id) => replyByDoc.has(id)),
    [docs, query, replyByDoc],
  );

  const [viewDoc, setViewDoc] = useState<ApprovalDoc | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // ── 회신 문서 업로드 — 숨긴 file input 하나를 행마다 돌려 쓴다 ──
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploadTarget, setUploadTarget] = useState<ApprovalDoc | null>(null);
  const pickReply = (doc: ApprovalDoc) => {
    setUploadTarget(doc);
    fileRef.current?.click();
  };
  const onFile = async (file: File | undefined) => {
    const doc = uploadTarget;
    if (fileRef.current) fileRef.current.value = '';
    if (!file || !doc) return;
    const prev = replyByDoc.get(doc.id);
    if (prev && !window.confirm(`이미 올린 회신 문서(${prev.name})를 새 파일로 바꿀까요?`)) return;
    setErr(null);
    try {
      await upload.mutateAsync({ doc, file, actor: { id: me.id, name: me.name } });
    } catch (e) {
      setErr(e instanceof Error ? e.message : '회신 문서를 올리지 못했습니다.');
    } finally {
      setUploadTarget(null);
    }
  };

  const downloadReply = async (reply: PoReply) => {
    setErr(null);
    try {
      await downloadFile(await poReplyRepo.downloadUrl(reply), reply.name);
    } catch {
      setErr('회신 문서를 내려받지 못했습니다.');
    }
  };

  // ── PDF — 화면 밖에 결재 문서를 그려 두고 그대로 떠서 저장한다 ──
  const pdfHostRef = useRef<HTMLDivElement>(null);
  const [pdfDoc, setPdfDoc] = useState<ApprovalDoc | null>(null);
  useEffect(() => {
    if (!pdfDoc) return;
    let cancelled = false;
    // 서식·사용자 정보가 그려질 시간을 준다(이미 캐시돼 있어 대개 바로 끝난다).
    const timer = setTimeout(async () => {
      const el = pdfHostRef.current?.querySelector<HTMLElement>('.approval-print');
      try {
        if (!el) throw new Error('no document');
        await exportElementToPdf(el, poPdfFileName(pdfDoc));
      } catch (e) {
        console.error('발주서 PDF 생성 실패:', e);
        if (!cancelled) setErr('PDF를 만들지 못했습니다. 잠시 후 다시 시도하세요.');
      } finally {
        if (!cancelled) setPdfDoc(null);
      }
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [pdfDoc]);

  const poViewer: PoViewer = { userId: me.id, deptId: '', deptName: me.dept, isManager };

  return (
    <main className="flex-1 flex flex-col gap-4 rounded-xl border border-border bg-panel p-5 shadow-sm overflow-hidden">
      {/* 상단: 제목 + 검색 */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3 shrink-0">
        <div>
          <h1 className="text-base font-extrabold text-ink flex items-center gap-2">
            <PackageCheck size={18} className="text-teal" />
            <span>결재 보관함 / 발주서 보관함</span>
          </h1>
          <p className="text-[11px] text-ink3 mt-0.5">
            결재가 완료된 발주서가 자동으로 보관됩니다. 거래처 직인이 찍힌 회신본을 올려 함께 보관하세요.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-lg border border-border-hi overflow-hidden text-[11px] font-bold">
            {REPLY_FILTERS.map((f) => (
              <button
                key={f.key}
                onClick={() => setQuery({ ...query, reply: f.key })}
                className={`px-2.5 py-1.5 transition-colors ${query.reply === f.key ? 'bg-teal text-white' : 'text-ink2 hover:bg-panel-alt'}`}
              >
                {f.label}
              </button>
            ))}
          </div>
          <input
            type="date"
            value={query.from}
            onChange={(e) => setQuery({ ...query, from: e.target.value })}
            aria-label="완료일 시작"
            className="h-8 rounded-lg border border-border-hi bg-panel px-2 text-[11px] outline-none focus:border-teal"
          />
          <span className="text-ink3">~</span>
          <input
            type="date"
            value={query.to}
            onChange={(e) => setQuery({ ...query, to: e.target.value })}
            aria-label="완료일 끝"
            className="h-8 rounded-lg border border-border-hi bg-panel px-2 text-[11px] outline-none focus:border-teal"
          />
          <div className="relative w-56">
            <input
              type="text"
              value={query.keyword}
              onChange={(e) => setQuery({ ...query, keyword: e.target.value })}
              placeholder="제목·문서번호·기안자 검색"
              className="h-8 w-full rounded-lg border border-border-hi bg-panel px-3 pr-7 text-[11px] outline-none focus:border-teal"
            />
            <Search size={13} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-ink3 pointer-events-none" />
          </div>
        </div>
      </div>

      {err && <p className="rounded-lg bg-red-500/10 px-3 py-2 text-[11.5px] font-semibold text-red-500 shrink-0">{err}</p>}

      {/* 목록 */}
      <div className="flex-1 overflow-auto rounded-lg border border-border bg-panel">
        <table className="w-full border-collapse text-left text-[11.5px]">
          <thead>
            <tr className="border-b border-border bg-panel-alt/50 font-bold text-ink2">
              <th className="p-3">제목</th>
              <th className="p-3 w-28">완료일자</th>
              <th className="p-3 w-32 text-center">다운로드</th>
              <th className="p-3 w-64">회신 문서</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr><td colSpan={4} className="p-12 text-center text-ink3">불러오는 중…</td></tr>
            )}
            {!isLoading && rows.length === 0 && (
              <tr>
                <td colSpan={4} className="p-12 text-center text-ink3">
                  {docs.length === 0 ? '결재가 완료된 발주서가 아직 없습니다.' : '검색 조건에 맞는 발주서가 없습니다.'}
                </td>
              </tr>
            )}
            {rows.map((d) => {
              const reply = replyByDoc.get(d.id);
              const canUpload = canUploadPoReply(d, poViewer);
              const uploading = upload.isPending && uploadTarget?.id === d.id;
              const making = pdfDoc?.id === d.id;
              return (
                <tr key={d.id} className="border-b border-border hover:bg-panel-alt/30 transition-colors">
                  <td className="p-3 min-w-0">
                    <button onClick={() => setViewDoc(d)} className="flex items-center gap-1.5 text-left font-semibold text-ink hover:text-teal transition-colors">
                      <FileText size={13} className="shrink-0 text-ink3" />
                      <span className="truncate">{d.title}</span>
                    </button>
                    <div className="mt-0.5 pl-5 text-[10.5px] text-ink3">
                      <span className="font-mono">{d.docNo}</span>
                      {(d.drafterName || d.drafterDept) && <span> · {[d.drafterDept, d.drafterName].filter(Boolean).join(' ')}</span>}
                    </div>
                  </td>
                  <td className="p-3 font-mono text-ink2">{completedDateOf(d) || '-'}</td>
                  <td className="p-3 text-center">
                    <button
                      onClick={() => setPdfDoc(d)}
                      disabled={pdfDoc !== null}
                      className="inline-flex items-center gap-1 rounded-lg border border-border-hi px-2.5 py-1 text-[11px] font-bold text-ink2 hover:border-teal hover:text-teal disabled:opacity-50 transition-colors"
                    >
                      {making ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
                      PDF
                    </button>
                  </td>
                  <td className="p-3">
                    <div className="flex items-center gap-1.5">
                      {reply ? (
                        <button
                          onClick={() => downloadReply(reply)}
                          title={`${reply.uploadedByName || reply.uploadedBy} · ${reply.uploadedAt.slice(0, 10)}`}
                          className="inline-flex min-w-0 items-center gap-1 rounded-lg bg-teal-soft/40 px-2 py-1 text-[11px] font-bold text-teal hover:bg-teal-soft transition-colors"
                        >
                          <FileCheck2 size={12} className="shrink-0" />
                          <span className="truncate max-w-[140px]">{reply.name}</span>
                        </button>
                      ) : (
                        !canUpload && <span className="text-[11px] text-ink3">회신 대기</span>
                      )}
                      {canUpload && (
                        <button
                          onClick={() => pickReply(d)}
                          disabled={upload.isPending}
                          className={`inline-flex shrink-0 items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-bold transition-colors disabled:opacity-50 ${
                            reply ? 'border border-border-hi text-ink3 hover:text-ink' : 'bg-teal text-white hover:opacity-90'
                          }`}
                        >
                          {uploading ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
                          {reply ? '교체' : '회신 문서 업로드'}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-[10.5px] text-ink3 shrink-0">총 {rows.length}건{rows.length !== docs.length && ` (전체 ${docs.length}건)`}</p>

      <input ref={fileRef} type="file" accept={REPLY_ACCEPT} className="hidden" onChange={(e) => void onFile(e.target.files?.[0])} />

      {/* 원문 보기 */}
      <Modal
        open={viewDoc !== null}
        onClose={() => setViewDoc(null)}
        title={viewDoc?.title}
        width={840}
        footer={
          viewDoc && (
            <button
              onClick={() => setPdfDoc(viewDoc)}
              disabled={pdfDoc !== null}
              className="inline-flex items-center gap-1 rounded-lg bg-teal px-3.5 py-1.5 text-[11.5px] font-bold text-white hover:opacity-90 disabled:opacity-50"
            >
              <Download size={13} /> PDF 다운로드
            </button>
          )
        }
      >
        {viewDoc && (
          <div className="overflow-x-auto">
            <ApprovalDocumentView doc={viewDoc} currentUser={{ id: me.id, dept: me.dept }} />
          </div>
        )}
      </Modal>

      {/* PDF 생성용 — 화면 밖에 A4 폭으로 그린다 */}
      {pdfDoc && (
        <div ref={pdfHostRef} aria-hidden className="pointer-events-none fixed top-0" style={{ left: -10000, width: 800 }}>
          <ApprovalDocumentView doc={pdfDoc} currentUser={{ id: me.id, dept: me.dept }} />
        </div>
      )}
    </main>
  );
}
