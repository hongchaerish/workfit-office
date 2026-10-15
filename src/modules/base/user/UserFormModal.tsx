import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Modal } from '@/shared/ui/Modal';
import { Field } from '@/shared/ui/form/Field';
import { TextField } from '@/shared/ui/form/TextField';
import { SelectField } from '@/shared/ui/form/SelectField';
import { ActionButton } from '@/shared/ui/ActionBar';
import { userFormSchema, DEFAULT_USER_PASSWORD, type User, type UserFormValues } from '@/domain/user/schema';
import { ACCOUNT_EDITABLE_STATUSES } from '@/domain/user/accountStatus';
import { useSuggestedEmpNo } from '@/features/user/useUsers';

export type { UserFormValues };

const EMPTY: UserFormValues = {
  empNo: '',
  name: '',
  dept: '미지정',
  position: '사원',
  jobTitle: '',
  email: '',
  status: '사용',
  password: '',
};

interface UserFormModalProps {
  open: boolean;
  initial?: User | null;
  onClose: () => void;
  onSubmit: (values: UserFormValues, id?: string) => void;
}

export default function UserFormModal({ open, initial, onClose, onSubmit }: UserFormModalProps) {
  const {
    register,
    handleSubmit,
    reset,
    setValue,
    getValues,
    formState: { errors, isSubmitting },
  } = useForm<UserFormValues>({
    resolver: zodResolver(userFormSchema) as any,
    defaultValues: EMPTY,
  });

  useEffect(() => {
    if (!open) return;
    reset(
      initial
        ? {
            empNo: initial.empNo,
            name: initial.name,
            dept: initial.dept || '미지정',
            position: initial.position || '사원',
            jobTitle: initial.jobTitle ?? '',
            email: initial.email,
            status: initial.status,
            password: '', // 수정 시 항상 빈칸(비우면 기존 비번 보존)
          }
        : EMPTY,
    );
  }, [open, initial, reset]);

  // 새 계정이면 다음 사번(올해 연도 끝 두 자리 + 순번)을 자동으로 채운다. 필요하면 고칠 수 있다.
  const suggested = useSuggestedEmpNo(open && !initial);
  useEffect(() => {
    if (open && !initial && suggested.data && !getValues('empNo')) setValue('empNo', suggested.data, { shouldValidate: true });
  }, [open, initial, suggested.data, getValues, setValue]);

  const retired = initial?.status === '미사용';

  const submit = handleSubmit((values: UserFormValues) => {
    // 인사정보(부서, 직급, 직책)는 임직원 관리에서 발령하므로 기존 값 보존
    const finalPayload: UserFormValues = {
      empNo: values.empNo,
      name: values.name,
      email: values.email,
      status: retired ? '미사용' : values.status,
      password: values.password,
      dept: initial?.dept || values.dept || '미지정',
      position: initial?.position || values.position || '사원',
      jobTitle: initial?.jobTitle || values.jobTitle || '',
    };
    onSubmit(finalPayload, initial?.id);
    onClose();
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={initial ? '사용자 계정 수정' : '사용자 계정 생성'}
      width={460}
      footer={
        <>
          <ActionButton icon="refresh" label="취소" onClick={onClose} />
          <ActionButton icon="save" label="저장" variant="primary" onClick={submit} disabled={isSubmitting} />
        </>
      }
    >
      <form onSubmit={submit} className="space-y-3.5">
        <div className="grid grid-cols-2 gap-3">
          <Field label="사번" required error={errors.empNo?.message}>
            <TextField {...register('empNo')} invalid={!!errors.empNo} placeholder={suggested.data ?? '예: 2613'} />
          </Field>
          <Field label="이름" required error={errors.name?.message}>
            <TextField {...register('name')} invalid={!!errors.name} placeholder="홍길동" />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="이메일" required error={errors.email?.message}>
            <TextField {...register('email')} invalid={!!errors.email} placeholder="user@workfit.co.kr" />
          </Field>
          <Field label="계정 상태" required error={errors.status?.message}>
            {/* 사용·잠금만 고른다. 미사용(퇴직)은 인명관리 퇴직 처리로만 들어가고 여기서 되돌리지 못한다 */}
            {retired ? (
              <TextField value="미사용 (퇴직)" readOnly disabled />
            ) : (
              <SelectField
                {...register('status')}
                invalid={!!errors.status}
                options={ACCOUNT_EDITABLE_STATUSES.map((s) => ({ value: s, label: s }))}
              />
            )}
          </Field>
        </div>

        <Field label={initial ? '비밀번호 변경' : '초기 비밀번호'} error={errors.password?.message}>
          <TextField
            type="password"
            autoComplete="new-password"
            {...register('password')}
            invalid={!!errors.password}
            placeholder={initial ? '변경 시에만 입력 (비우면 기존 유지)' : `비우면 기본값 ${DEFAULT_USER_PASSWORD}`}
          />
        </Field>
      </form>
    </Modal>
  );
}
