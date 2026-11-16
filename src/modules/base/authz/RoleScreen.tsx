import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { nextRoleDraft } from './roleDraft';
import { ArrowRight, Check, Plus } from 'lucide-react';
import { Card } from '@/shared/ui/Card';
import { Button } from '@/shared/ui/Button';
import { Pill } from '@/shared/ui/Pill';
import { Toggle } from '@/shared/ui/Toggle';
import { Modal } from '@/shared/ui/Modal';
import { TextField } from '@/shared/ui/form/TextField';
import { AUTHZ_AREAS, PERMISSIONS, PERMISSION_BY_KEY, SUPER_ADMIN_PERMISSIONS, expandPermissions, type PermissionDef } from '@/domain/authz/permissions';
import { ROLE_TEMPLATES } from '@/domain/authz/templates';
import type { AuthRole } from '@/domain/authz/types';
import { useAuthzActions, useAuthzDraft } from '@/features/authz/useAuthzDraft';
import { adminPath } from '@/app/shell/screens';
import { MigrationPanel } from './MigrationPanel';
import { Loading, PageHead, RoleList, TARGET_ICON, roleUserCount, scopeText, targetText, useAuthzNotice } from './parts';

type Tab = 'work' | 'admin';

/** 체크한 권한이 포함하는(따라오는) 권한 */
function impliedBy(keys: Set<string>): Map<string, string> {
  const out = new Map<string, string>();
  for (const k of keys) for (const i of PERMISSION_BY_KEY.get(k)?.implies ?? []) out.set(i, PERMISSION_BY_KEY.get(k)!.name);
  return out;
}

export default function RoleScreen() {
  const { ready, roles, assignments, org, authzOrg, activeUsers } = useAuthzDraft();
  const actions = useAuthzActions();
  const notice = useAuthzNotice();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const selectedId = params.get('role') ?? roles.find((r) => r.kind === 'custom')?.id ?? roles[0]?.id ?? null;
  const selected = roles.find((r) => r.id === selectedId) ?? null;

  const [draft, setDraft] = useState<AuthRole | null>(selected);
  const [tab, setTab] = useState<Tab>('work');
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState(false);
  // 역할 목록을 다시 받아도(저장·다른 관리자 수정 신호) 저장 안 한 수정은 지우지 않는다 — 다른 역할을 고를 때만 바꾼다
  const prevSelected = useRef(selected);
  const tabFor = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    const prev = prevSelected.current;
    prevSelected.current = selected;
    setDraft((d) => nextRoleDraft(prev, selected, d));
    if (tabFor.current === (selected?.id ?? null)) return;
    tabFor.current = selected?.id ?? null;
    const hasWork = selected?.permissions.some((k) => !PERMISSION_BY_KEY.get(k)?.adminConsole);
    setTab(selected?.kind === 'super' || (selected && !hasWork && selected.permissions.length > 0) ? 'admin' : 'work');
  }, [selected]);

  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(selected), [draft, selected]);
  const select = (id: string) => setParams({ role: id });
  const countOf = (r: AuthRole) => roleUserCount(r, assignments, activeUsers, authzOrg);

  if (ready && roles.length === 0) {
    return (
      <div className="flex flex-col gap-3.5">
        <PageHead title="역할 관리" path="권한 / 역할 관리" desc="권한을 묶어 역할을 만듭니다" />
        <MigrationPanel org={org} />
      </div>
    );
  }
  if (!ready || !draft) {
    return (
      <div className="flex flex-col gap-3.5">
        <PageHead title="역할 관리" path="권한 / 역할 관리" desc="권한을 묶어 역할을 만듭니다" />
        <Loading />
      </div>
    );
  }

  const isSuper = draft.kind === 'super';
  const isBase = draft.kind === 'base';
  const checked = new Set(isSuper ? SUPER_ADMIN_PERMISSIONS : draft.permissions);
  const implied = impliedBy(checked);
  const myAssignments = assignments.filter((a) => a.roleId === draft.id);

  const lockReason = (p: PermissionDef): string | null => {
    if (isSuper) return '최고 관리자 고정';
    if (p.grantable === false) return '최고 관리자 전용';
    if (isBase && p.adminConsole) return '전 직원에게는 줄 수 없음';
    return null;
  };
  const toggle = (key: string, on: boolean) => {
    const next = new Set(draft.permissions);
    if (on) next.add(key);
    else next.delete(key);
    setDraft({ ...draft, permissions: [...next].sort() });
  };
  /** 영역 모두 선택·해제 — 고정·전용 권한은 건드리지 않는다 */
  const toggleAll = (keys: string[], on: boolean) => {
    const next = new Set(draft.permissions);
    for (const k of keys) {
      if (on) next.add(k);
      else next.delete(k);
    }
    setDraft({ ...draft, permissions: [...next].sort() });
  };

  // 만든 역할에는 전 직원이 이미 받는 권한을 보이지 않는다
  const baseRole = roles.find((r) => r.kind === 'base');
  const basePerms = draft.kind === 'custom' && baseRole?.use ? expandPermissions(baseRole.permissions) : new Set<string>();
  const shown = PERMISSIONS.filter((p) => !basePerms.has(p.key));
  const areas = AUTHZ_AREAS.filter((a) => (tab === 'admin') === a.id.startsWith('admin') && shown.some((p) => p.area === a.id));
  const countIn = (admin: boolean) => shown.filter((p) => !!p.adminConsole === admin && (checked.has(p.key) || implied.has(p.key))).length;

  return (
    <div className="flex flex-col gap-3.5">
      <PageHead
        title="역할 관리"
        path="권한 / 역할 관리"
        desc="권한을 묶어 역할을 만들고, 역할 지정에서 누구에게 줄지 정합니다"
        actions={
          <Button variant="primary" onClick={() => setCreating(true)}>
            <span className="inline-flex items-center gap-1">
              <Plus size={13} />새 역할
            </span>
          </Button>
        }
      />

      <div className="grid grid-cols-[280px_minmax(0,1fr)] items-start gap-3.5">
        <RoleList roles={roles} selectedId={draft.id} onSelect={select} countOf={countOf} />

        <div className="flex min-w-0 flex-col gap-3.5">
          {/* 기본 정보 */}
          <Card
            title={
              <span className="flex items-center gap-2">
                {draft.name}
                {isSuper && <Pill tone="info">기본 역할</Pill>}
                {isBase && <Pill tone="info">기본 역할 · 모든 직원</Pill>}
              </span>
            }
            action={
              <div className="flex items-center gap-2">
                {draft.kind === 'custom' && (
                  <Button variant="danger" size="sm" onClick={() => setDeleting(true)}>
                    삭제
                  </Button>
                )}
                <Button size="sm" disabled={!dirty} onClick={() => setDraft(selected)}>
                  되돌리기
                </Button>
                <Button variant="primary" size="sm" disabled={!dirty || !draft.name.trim() || actions.pending} onClick={() => notice.run(() => actions.saveRole(draft))}>
                  저장
                </Button>
              </div>
            }
          >
            <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto] items-end gap-3.5">
              <label className="flex flex-col gap-1.5">
                <span className="text-[11.5px] font-bold text-ink2">역할 이름</span>
                <TextField value={draft.name} disabled={draft.kind !== 'custom'} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-[11.5px] font-bold text-ink2">설명</span>
                <TextField value={draft.desc} onChange={(e) => setDraft({ ...draft, desc: e.target.value })} />
              </label>
              <div className="flex flex-col gap-1.5">
                <span className="text-[11.5px] font-bold text-ink2">사용</span>
                <div className="flex h-[38px] items-center">
                  {draft.kind === 'custom' ? <Toggle on={draft.use} onChange={(v) => setDraft({ ...draft, use: v })} /> : <span className="text-[12px] text-ink3">항상 사용</span>}
                </div>
              </div>
            </div>
          </Card>

          {/* 권한 */}
          <Card
            title="권한"
            bodyClassName="p-0"
            action={
              <div className="flex rounded-lg border border-border p-0.5 text-[11.5px] font-bold">
                {(
                  [
                    ['work', '업무 권한', countIn(false)],
                    ['admin', '관리자 권한', countIn(true)],
                  ] as const
                ).map(([id, label, n]) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setTab(id)}
                    className={`rounded-md px-3 py-1 transition-colors ${tab === id ? 'bg-teal text-white' : 'text-ink3 hover:text-ink'}`}
                  >
                    {label} <span className="tabular-nums opacity-80">{n}</span>
                  </button>
                ))}
              </div>
            }
          >
            {isSuper && tab === 'work' ? (
              <div className="px-5 py-10 text-center text-[12.5px] text-ink3">
                최고 관리자는 모든 업무 권한을 전사 범위로 갖습니다. 따로 지정할 필요가 없습니다.
              </div>
            ) : (
              areas.map((area) => {
                const perms = shown.filter((p) => p.area === area.id);
                const on = perms.filter((p) => checked.has(p.key) || implied.has(p.key)).length;
                const editable = perms.filter((p) => !lockReason(p)).map((p) => p.key);
                const allOn = editable.length > 0 && editable.every((k) => checked.has(k) || implied.has(k));
                return (
                  <section key={area.id} className="border-t border-border first:border-t-0">
                    <div className="flex items-center justify-between gap-3 bg-panel-alt/60 px-5 py-2">
                      <span className="text-[12px] font-extrabold text-navy">{area.name}</span>
                      <span className="flex items-center gap-3">
                        <span className="text-[11px] tabular-nums text-ink3">
                          {on} / {perms.length}
                        </span>
                        {editable.length > 0 && (
                          <button
                            type="button"
                            onClick={() => toggleAll(editable, !allOn)}
                            className="rounded-md border border-border bg-panel px-2.5 py-0.5 text-[11px] font-bold text-ink2 transition-colors hover:border-teal hover:text-teal"
                          >
                            {allOn ? '모두 해제' : '모두 선택'}
                          </button>
                        )}
                      </span>
                    </div>
                    <ul className="m-0 list-none p-0">
                      {perms.map((p) => {
                        const lock = lockReason(p);
                        const viaImplied = !checked.has(p.key) ? implied.get(p.key) : undefined;
                        const isOn = checked.has(p.key) || Boolean(viaImplied);
                        const disabled = Boolean(lock) || Boolean(viaImplied);
                        return (
                          <li key={p.key} className="border-t border-border/60 first:border-t-0">
                            <label className={`flex items-center gap-3 px-5 py-2.5 ${disabled ? 'cursor-default' : 'cursor-pointer hover:bg-panel-alt/50'}`}>
                              <span
                                className={`grid h-[18px] w-[18px] shrink-0 place-items-center rounded-[5px] border transition-colors ${
                                  isOn ? (disabled ? 'border-teal/40 bg-teal/40 text-white' : 'border-teal bg-teal text-white') : 'border-border-hi bg-panel'
                                } ${lock && !isOn ? 'opacity-40' : ''}`}
                              >
                                {isOn && <Check size={12} strokeWidth={3} />}
                              </span>
                              <input type="checkbox" className="sr-only" checked={isOn} disabled={disabled} onChange={(e) => toggle(p.key, e.target.checked)} />
                              <span className="min-w-0 flex-1">
                                <span className={`block text-[12.5px] font-bold ${lock && !isOn ? 'text-ink3' : 'text-ink'}`}>{p.name}</span>
                                <span className="block truncate text-[11px] text-ink3">{p.desc}</span>
                              </span>
                              {viaImplied && <span className="shrink-0 text-[10.5px] text-ink3">{viaImplied}에 포함</span>}
                              {p.scoped && !isSuper && <Pill tone="info">범위 지정</Pill>}
                              {lock && lock !== '최고 관리자 고정' && <Pill tone="mute">{lock}</Pill>}
                            </label>
                          </li>
                        );
                      })}
                    </ul>
                  </section>
                );
              })
            )}
          </Card>

          {/* 받는 대상 */}
          <Card
            title={
              <span>
                받는 대상 <span className="ml-1 text-[12px] font-semibold tabular-nums text-ink3">{countOf(draft)}명</span>
              </span>
            }
            action={
              !isBase && (
                <Button size="sm" variant="accent" onClick={() => navigate(`${adminPath('/base/authz/assign')}?role=${draft.id}`)}>
                  <span className="inline-flex items-center gap-1">
                    역할 지정에서 바꾸기 <ArrowRight size={12} />
                  </span>
                </Button>
              )
            }
            bodyClassName="p-0"
          >
            {isBase ? (
              <div className="px-5 py-4 text-[12.5px] text-ink2">사용 중인 모든 직원이 자동으로 받습니다.</div>
            ) : myAssignments.length === 0 ? (
              <div className="px-5 py-8 text-center text-[12.5px] text-ink3">아직 이 역할을 받은 대상이 없습니다.</div>
            ) : (
              <ul className="m-0 list-none p-0">
                {myAssignments.map((a) => {
                  const Icon = TARGET_ICON[a.targetType];
                  const t = targetText(a, authzOrg, org.users);
                  return (
                    <li key={a.id} className="flex items-center gap-3 border-t border-border/60 px-5 py-2.5 first:border-t-0">
                      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-panel-alt text-ink2">
                        <Icon size={14} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[12.5px] font-bold text-ink">{t.main}</span>
                        <span className="block truncate text-[11px] text-ink3">{t.sub}</span>
                      </span>
                      {!isSuper && draft.permissions.some((k) => PERMISSION_BY_KEY.get(k)?.scoped) && (
                        <span className="shrink-0 text-[11.5px] text-ink2">범위 · {scopeText(a, authzOrg)}</span>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </div>
      </div>

      {notice.node}
      <NewRoleDialog
        open={creating}
        names={roles.map((r) => r.name)}
        onClose={() => setCreating(false)}
        onCreate={(p) => {
          void notice.run(async () => {
            const r = await actions.createRole(p);
            setCreating(false);
            select(r.id);
          });
        }}
      />

      <Modal
        open={deleting}
        onClose={() => setDeleting(false)}
        title="역할 삭제"
        footer={
          <>
            <Button onClick={() => setDeleting(false)}>취소</Button>
            <Button
              variant="dangerSolid"
              onClick={() => {
                setDeleting(false);
                void notice.run(async () => {
                  await actions.removeRole(draft.id);
                  setParams({});
                });
              }}
            >
              삭제
            </Button>
          </>
        }
      >
        <p className="text-[13px] leading-relaxed text-ink2">
          <b className="text-ink">{draft.name}</b> 역할을 삭제하면 이 역할을 받은 {countOf(draft)}명이 이 역할의 권한을 잃습니다.
        </p>
      </Modal>
    </div>
  );
}

function NewRoleDialog({
  open,
  names,
  onClose,
  onCreate,
}: {
  open: boolean;
  names: string[];
  onClose: () => void;
  onCreate: (p: { name: string; desc: string; permissions: string[] }) => void;
}) {
  const [tpl, setTpl] = useState('blank');
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  useEffect(() => {
    if (open) {
      setTpl('blank');
      setName('');
      setDesc('');
    }
  }, [open]);
  const dup = names.includes(name.trim());
  const pick = (id: string) => {
    const t = ROLE_TEMPLATES.find((x) => x.id === id)!;
    setTpl(id);
    if (id !== 'blank') {
      if (!name.trim() || ROLE_TEMPLATES.some((x) => x.name === name.trim())) setName(t.name);
      if (!desc.trim() || ROLE_TEMPLATES.some((x) => x.desc === desc.trim())) setDesc(t.desc);
    }
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="새 역할"
      width={520}
      footer={
        <>
          <Button onClick={onClose}>취소</Button>
          <Button
            variant="primary"
            disabled={!name.trim() || dup}
            onClick={() => onCreate({ name: name.trim(), desc: desc.trim(), permissions: ROLE_TEMPLATES.find((x) => x.id === tpl)!.permissions })}
          >
            만들기
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div>
          <div className="mb-2 text-[11.5px] font-bold text-ink2">시작할 모양</div>
          <div className="grid grid-cols-2 gap-2">
            {ROLE_TEMPLATES.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => pick(t.id)}
                className={`rounded-lg border px-3 py-2.5 text-left transition-colors ${tpl === t.id ? 'border-teal bg-teal-soft/40' : 'border-border hover:border-border-hi'}`}
              >
                <span className={`block text-[12.5px] font-bold ${tpl === t.id ? 'text-teal' : 'text-ink'}`}>{t.name}</span>
                <span className="mt-0.5 block text-[11px] leading-snug text-ink3">{t.desc}</span>
              </button>
            ))}
          </div>
        </div>
        <label className="flex flex-col gap-1.5">
          <span className="text-[11.5px] font-bold text-ink2">역할 이름</span>
          <TextField value={name} onChange={(e) => setName(e.target.value)} placeholder="예: 결재 관리자" />
          {dup && <span className="text-[11px] text-danger">같은 이름의 역할이 이미 있습니다.</span>}
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-[11.5px] font-bold text-ink2">설명</span>
          <TextField value={desc} onChange={(e) => setDesc(e.target.value)} />
        </label>
      </div>
    </Modal>
  );
}
