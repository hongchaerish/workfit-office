import { useAuth } from '@/app/auth/AuthProvider';
import { usePermission } from '@/features/auth/usePermission';
import { newBizCategoryId, type BizCategory } from '@/domain/company/masters';
import { useBizCategories, useSaveBizCategory } from '@/features/company/useCompanies';
import { MasterListView } from './MasterListView';

/** 관리자 콘솔 › 회사·운영 › 사업구분 — 정부사업 종류(부처협업형·제조AI…). 기준정보. */
export default function BizCategoryScreen() {
  const { canAction } = usePermission();
  const { user } = useAuth();
  const { data = [], isLoading } = useBizCategories();
  const save = useSaveBizCategory();
  return (
    <MasterListView<BizCategory>
      head={
        <div>
          <h1 className="text-xl font-extrabold tracking-tight text-ink">사업구분</h1>
          <p className="mt-0.5 text-xs text-ink3">회사·운영 / 사업구분</p>
        </div>
      }
      label="사업구분"
      rows={data}
      isLoading={isLoading}
      canEdit={canAction('S_ADM_BIZ_CATEGORY', 'update')}
      newRow={(order) => ({ id: newBizCategoryId(), name: '', order, use: true, note: '', createdBy: '', createdAt: '', updatedBy: '', updatedAt: '' })}
      onSave={({ item, isNew }) => save.mutateAsync({ item, isNew, actorId: user?.id ?? '' })}
    />
  );
}
