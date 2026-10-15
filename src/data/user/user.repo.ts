import { userSchema, DEFAULT_USER_PASSWORD, type User, type UserFormValues } from '@/domain/user/schema';
import { USER_SEED } from '@/data/seeds/user.seed';
import { createCrudBackend } from '@/data/_backend/crudBackend';
import { hideTestAccountRows, registerTestAccountSource, rememberTestAccounts } from '@/data/_backend/testAccountVisibility';
import { hashPassword } from '@/shared/lib/crypto';
import { nowLocalIso } from '@/shared/lib/datetime';

/**
 * 사용자 Repository — DB 접근을 캡슐화하는 유일한 계층.
 * ([[DB_이관_대비_설계원칙.md]] 원칙 1 / [[data-layer-pattern]])
 * 저장은 공유 CrudBackend(VITE_DB_DRIVER)로 위임. 파생 로직만 여기 유지.
 * 문서 ID = user.id.
 */
const backend = createCrudBackend<User>({
  coll: 'users',
  parse: (raw) => {
    const p = userSchema.safeParse(raw);
    if (!p.success) {
      console.error('Failed to parse user:', p.error);
      return null;
    }
    return p.data;
  },
  idOf: (u) => u.id,
  seed: USER_SEED.map((u) => userSchema.parse(u)),
});

export interface UserFilter {
  dept?: string;
  status?: string;
  q?: string;
}

function applyFilter(rows: User[], f?: UserFilter): User[] {
  if (!f) return rows;
  const kw = f.q?.trim().toLowerCase() ?? '';
  return rows.filter(
    (u) =>
      (!f.dept || u.dept === f.dept) &&
      (!f.status || u.status === f.status) &&
      (!kw || [u.empNo, u.name].some((v) => v.toLowerCase().includes(kw))),
  );
}

/** 차기 ID 채번(U0NN) — 운영 시 counters 컬렉션으로 대체. */
function nextId(rows: User[]): string {
  const max = rows.reduce((m, u) => {
    const n = Number(u.id.replace(/\D/g, ''));
    return Number.isFinite(n) && n > m ? n : m;
  }, 0);
  return `U${String(max + 1).padStart(3, '0')}`;
}

import { assertAccountStatusEdit } from '@/domain/user/accountStatus';
import { employeeProfileRepo } from '@/data/employeeProfile/employeeProfile.repo';
import type { EmployeeProfile } from '@/domain/employeeProfile/schema';

registerTestAccountSource(() => backend.loadAll());

export const userRepo = {
  /**
   * 화면용 사용자 목록 — 접속자가 볼 수 없는 테스트 계정은 빠진다([[testAccountVisibility]]).
   * 새 화면·모듈은 이것만 쓰면 테스트 계정 공개 범위를 자동으로 따른다.
   */
  async list(filter?: UserFilter): Promise<User[]> {
    const all = await this.listIncludingTestAccounts(filter);
    return hideTestAccountRows(all, (u) => [u.id]);
  },

  /**
   * 테스트 계정까지 포함한 전체 목록 — 로그인·권한 판정·채번·저장 경로 전용.
   * 화면에 그대로 뿌리면 임직원에게 테스트 계정이 드러난다.
   */
  async listIncludingTestAccounts(filter?: UserFilter): Promise<User[]> {
    const rawUsers = await backend.loadAll();
    let profiles: EmployeeProfile[] = [];
    try {
      profiles = await employeeProfileRepo.listIncludingTestAccounts();
    } catch {
      // ignore
    }
    const profileMap = new Map(profiles.map((p) => [p.userId || p.id, p]));
    // 원본 부서가 '테스트'인데 인사 프로필 부서가 일반 부서인 경우도 테스트 계정으로 본다
    rememberTestAccounts([...rawUsers, ...profiles.map((p) => ({ id: p.userId, name: p.name, dept: p.dept }))]);
    const joined = rawUsers.map((u) => {
      const p = profileMap.get(u.id);
      return {
        ...u,
        dept: p?.dept || u.dept || '미지정',
        position: p?.position || u.position || '사원',
        jobTitle: p?.jobTitle || u.jobTitle || '',
        phone: p?.phone || (u as any).phone || '',
      };
    });
    return applyFilter(joined, filter);
  },

  async get(id: string): Promise<User | null> {
    const all = await this.listIncludingTestAccounts();
    return all.find((u) => u.id === id) ?? null;
  },

  /** 신규 등록 — id 채번 후 저장. */
  async create(values: UserFormValues): Promise<User> {
    assertAccountStatusEdit(undefined, values.status);
    const all = await this.listIncludingTestAccounts();
    // 초기 비밀번호: 입력값 우선, 비우면 공통 기본값(mes1234) 부여 → 등록 즉시 로그인 가능.
    const plainPassword = values.password?.trim() || DEFAULT_USER_PASSWORD;
    const password = await hashPassword(plainPassword);
    const user = userSchema.parse({ ...values, password, id: nextId(all), lastLogin: '-' });
    await this.save(user);
    return user;
  },

  /** 기존 사용자 수정 — lastLogin 등 시스템 필드 보존. 비밀번호는 입력 시에만 변경. */
  async update(id: string, values: UserFormValues): Promise<void> {
    const existing = (await this.listIncludingTestAccounts()).find((u) => u.id === id);
    // 미사용(퇴직)은 인명관리 퇴직 처리로만 — 사용자 관리 저장으로 들어가거나 빠져나오지 못하게
    assertAccountStatusEdit(existing?.status, values.status);
    // 비밀번호를 비워두면 기존 비밀번호 보존, 입력하면 해당 값으로 변경.
    let password = existing?.password || '';
    if (values.password?.trim()) {
      password = await hashPassword(values.password.trim());
    }
    await this.save(userSchema.parse({ ...existing, ...values, password, id }));
  },

  /** 프로필 자기 수정 — 사용자가 직접 변경 가능한 필드만(이메일, 인감 URL, 서명 URL, 선택 타입, 프로필 사진). */
  async updateProfile(id: string, patch: { email?: string; sealUrl?: string; signUrl?: string; signType?: 'stamp' | 'signature'; photoUrl?: string }): Promise<User> {
    const all = await this.listIncludingTestAccounts();
    const existing = all.find((u) => u.id === id);
    if (!existing) throw new Error('사용자를 찾을 수 없습니다.');
    const updated = userSchema.parse({ ...existing, ...patch, id });
    await this.save(updated);
    return updated;
  },

  async updateActiveChatRoom(userId: string, roomId: string | null): Promise<void> {
    const all = await this.listIncludingTestAccounts();
    const existing = all.find((u) => u.id === userId);
    if (!existing) return;
    const updated = {
      ...existing,
      activeChatRoomId: roomId,
    };
    await this.save(updated);
  },

  async save(user: User): Promise<void> {
    const raw = userSchema.parse(user);
    await backend.save(raw);
  },

  /**
   * 퇴사 처리(Phase 1) — 계정 비활성화 + 상급자 체인 재연결.
   * 1) 대상 계정: status='미사용', resignedAt 기록, fcmToken 제거(푸시 무효화).
   * 2) 상급자 재연결: 대상을 managerId 로 둔 직원들을 대상의 상급자(차상위)로 재지정
   *    → 상신선 자동생성이 끊기지 않도록 함.
   * ⚠ 진행중 결재선 정체는 여기서 자동 해소하지 않는다(Phase 2). 화면에서 사전 경고.
   * @returns 재연결된 부하직원 수.
   */
  async resign(userId: string): Promise<{ reconnectedReports: number }> {
    const all = await this.listIncludingTestAccounts();
    const target = all.find((u) => u.id === userId);
    if (!target) throw new Error('사용자를 찾을 수 없습니다.');

    // 1) 계정 비활성화 + 퇴사 기록 + 푸시 토큰 무효화.
    await this.save({ ...target, status: '미사용', resignedAt: nowLocalIso(), fcmToken: '' });

    // 2) 상급자 체인 재연결(대상을 상급자로 둔 직원 → 대상의 상급자).
    const reports = all.filter((u) => u.managerId === userId && u.id !== userId);
    await Promise.all(
      reports.map((r) => this.save({ ...r, managerId: target.managerId ?? null })),
    );

    return { reconnectedReports: reports.length };
  },

  /** FCM 푸시 토큰 저장(웹 PWA·모바일 공용 users.fcmToken). 서버 트리거가 이 토큰으로 발송.
   *  같은 브라우저/기기에서 다른 계정으로 로그인하면 그 기기의 단일 FCM 토큰이 여러 계정에
   *  남아 중복·오배송이 생긴다. 이를 막기 위해, 저장 전에 **같은 토큰을 가진 다른 계정의
   *  토큰을 회수**해 하나의 FCM 토큰이 한 계정에만 매핑되도록 한다(최근 로그인 우선). */
  async updateFcmToken(userId: string, token: string): Promise<void> {
    const all = await this.listIncludingTestAccounts();
    const existing = all.find((u) => u.id === userId);
    if (!existing) return;

    // 다른 계정이 쥐고 있던 동일 토큰 회수(빈 토큰은 대상 아님)
    if (token) {
      const stale = all.filter((u) => u.id !== userId && u.fcmToken === token);
      await Promise.all(stale.map((u) => this.save({ ...u, fcmToken: '' })));
    }

    if (existing.fcmToken === token) return; // 현재 계정 토큰 동일 → 저장 생략
    await this.save({ ...existing, fcmToken: token });
  },

  async updateJobTitle(id: string, jobTitle: string): Promise<void> {
    const existing = (await this.listIncludingTestAccounts()).find((u) => u.id === id);
    if (!existing) return;
    await this.save({ ...existing, jobTitle });
  },

  async updateDept(id: string, dept: string): Promise<void> {
    const existing = (await this.listIncludingTestAccounts()).find((u) => u.id === id);
    if (!existing) return;
    await this.save({ ...existing, dept });
  },

  async removeMany(ids: Array<string | number>): Promise<void> {
    const set = new Set(ids.map(String));
    await Promise.all([...set].map((id) => backend.remove(id)));
  },
};
