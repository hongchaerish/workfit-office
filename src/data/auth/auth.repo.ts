import { userRepo } from '@/data/user/user.repo';
import type { User } from '@/domain/user/schema';
import { hashPassword } from '@/shared/lib/crypto';
import { FALLBACK_ADMIN_USER } from '@/features/auth/mesSso';

/**
 * 인증 Repository — 자체 로그인(users 컬렉션 대조) UI 게이트.
 * ⚠ 클라이언트 평문 대조 = 진짜 보안 아님. Firestore 보안룰의 request.auth 를
 *    채우지 못한다. 진짜 인증은 후속(Cloud Function custom token). ([[firebase-backend-setup]])
 *
 * Firebase 미설정 시에도 userRepo 가 seed 로 degrade 하므로 그대로 동작한다.
 */

/** 로그인 실패 사유 코드 → 화면에서 메시지 매핑. */
export type AuthErrorCode = 'NOT_FOUND' | 'WRONG_PASSWORD' | 'LOCKED' | 'DISABLED';

export class AuthError extends Error {
  constructor(public code: AuthErrorCode) {
    super(code);
    this.name = 'AuthError';
  }
}

/** 'YYYY-MM-DD HH:mm' 로컬 시각. */
function nowStamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export const authRepo = {
  /**
   * 사번(empNo/id), 전체 이메일, 또는 이메일 아이디(@ 앞부분) + 비밀번호로 인증. 성공 시 User 반환.
   * 실패 시 AuthError(code) throw.
   */
  async authenticate(loginId: string, password: string): Promise<User> {
    const id = loginId.trim();
    const key = id.toLowerCase();
    const users = await userRepo.list();
    const user = users.find((u) => {
      const empNoMatch = u.empNo ? u.empNo.toLowerCase() === key : false;
      const idMatch = u.id ? u.id.toLowerCase() === key : false;
      const emailMatch = u.email ? u.email.toLowerCase() === key : false;
      const emailIdMatch = u.email ? u.email.split('@')[0].toLowerCase() === key : false;
      return empNoMatch || idMatch || emailMatch || emailIdMatch;
    });

    // admin / admin1234! 또는 amdin1234! 시스템 관리자 자격증명 지원
    const isMasterAdminPw = password === 'admin1234!' || password === 'amdin1234!';
    if (key === 'admin' && isMasterAdminPw) {
      if (user && user.status === '사용') return user;
      const topAdmin = users.find((u) => u.id === 'U001' && u.status === '사용');
      if (topAdmin) return { ...topAdmin, name: '최고관리자 (admin)' };
      return FALLBACK_ADMIN_USER;
    }

    if (!user) throw new AuthError('NOT_FOUND');
    if (user.status === '잠금') throw new AuthError('LOCKED');
    if (user.status === '미사용') throw new AuthError('DISABLED');
    
    const hashedPassword = await hashPassword(password);
    if (user.password !== hashedPassword) throw new AuthError('WRONG_PASSWORD');

    return user;
  },

  /**
   * 비밀번호 변경 — 현재 비밀번호 검증 후 새 비밀번호로 저장(DB 영구화).
   * 성공 시 갱신된 User 반환. 현재 비밀번호 불일치 시 AuthError('WRONG_PASSWORD').
   * 새 비밀번호 형식 검증(길이 등)은 화면에서 수행.
   */
  async changePassword(userId: string, currentPassword: string, newPassword: string): Promise<User> {
    const users = await userRepo.list();
    const user = users.find((u) => u.id === userId);
    if (!user) throw new AuthError('NOT_FOUND');
    
    const hashedCurrent = await hashPassword(currentPassword);
    if (user.password !== hashedCurrent) throw new AuthError('WRONG_PASSWORD');
    
    const hashedNew = await hashPassword(newPassword);
    const updated = { ...user, password: hashedNew };
    await userRepo.save(updated);
    return updated;
  },

  /** 로그인 성공 시 최근 접속시각 갱신(best-effort, 실패해도 로그인은 유지). */
  async touchLastLogin(userId: string): Promise<void> {
    try {
      const users = await userRepo.list();
      const user = users.find((u) => u.id === userId);
      if (user) await userRepo.save({ ...user, lastLogin: nowStamp() });
    } catch {
      /* 접속시각 갱신 실패는 로그인 흐름에 영향 없음 */
    }
  },
};
