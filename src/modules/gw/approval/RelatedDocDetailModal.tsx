import { useEffect, useState } from 'react';
import { FileText, X } from 'lucide-react';
import type { ApprovalDoc } from '@/domain/approvalDoc/schema';
import { approvalDocRepo } from '@/data/approvalDoc/approvalDoc.repo';
import { ApprovalDocumentView } from './ApprovalDocumentView';

interface RelatedDocDetailModalProps {
  docId: string;
  onClose: () => void;
}

export function RelatedDocDetailModal({ docId, onClose }: RelatedDocDetailModalProps) {
  const [doc, setDoc] = useState<ApprovalDoc | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    const fetchDoc = async () => {
      setLoading(true);
      try {
        const data = await approvalDocRepo.get(docId);
        if (active) setDoc(data);
      } catch (err) {
        console.error('Failed to load related document:', err);
      } finally {
        if (active) setLoading(false);
      }
    };
    fetchDoc();
    return () => {
      active = false;
    };
  }, [docId]);

  return (
    <div
      className="fixed inset-0 z-[150] flex items-center justify-center bg-black/55 p-4 backdrop-blur-xs select-none"
      onClick={(e) => {
        e.stopPropagation();
        onClose();
      }}
    >
      <div
        className="flex max-h-[calc(82vh/var(--font-scale,1))] w-full max-w-3xl flex-col rounded-2xl border border-border bg-panel shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 헤더 */}
        <div className="flex items-center justify-between border-b border-border bg-panel-alt/40 px-6 py-3.5">
          <div className="flex items-center gap-2">
            <FileText size={18} className="text-teal" />
            <h2 className="text-sm font-bold text-ink">
              관련 문서 상세 보기 {doc && <span className="font-mono text-teal ml-1.5">[{doc.docNo}]</span>}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl bg-[#4ea8de]/10 text-[#4ea8de] hover:bg-[#4ea8de] hover:text-white px-3.5 py-1.5 text-[11.5px] font-bold active:scale-95 transition-all cursor-pointer flex items-center gap-1"
          >
            <X size={13} /> 닫고 원본으로 복귀
          </button>
        </div>

        {/* 바디 상세 뷰어 */}
        <div className="menu-scroll flex-1 overflow-y-auto p-5 bg-panel-alt/10">
          {loading ? (
            <div className="py-24 text-center text-[12px] text-ink3 flex flex-col items-center gap-2">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-[#4ea8de] border-t-transparent" />
              <span>문서를 조회하고 있습니다...</span>
            </div>
          ) : !doc ? (
            <div className="py-24 text-center text-[12px] text-rose-500">
              해당 문서가 존재하지 않거나, 열람할 수 있는 권한이 부족합니다.
            </div>
          ) : (
            <div className="flex justify-center bg-white rounded-xl shadow-xs border border-border p-5 overflow-x-auto">
              <div className="w-[800px] shrink-0" style={{ zoom: 0.82 }}>
                <ApprovalDocumentView doc={doc} isPreview={true} />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
