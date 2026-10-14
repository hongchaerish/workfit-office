/**
 * 로그인 ID → 사용자. 앱 로그인(`src/data/auth/auth.repo.ts` authenticate)과 같은 규칙이다:
 * 사번 · 사용자 ID · 이메일 · 이메일 앞부분(대소문자 무시).
 *
 * 규칙이 다르면 앱에는 들어가지는데 토큰은 못 받는 사람이 생긴다. 그 사람에게는
 * 토큰을 요구하는 기능(설문·메일, Widdy 권한 문서)이 동작하지 않는다.
 */
export function findLoginUser(users, loginId) {
  const key = String(loginId || '').trim().toLowerCase();
  if (!key) return undefined;
  return users.find((u) => {
    const email = String(u.email || '').toLowerCase();
    return String(u.empNo || '').toLowerCase() === key
      || String(u.id || u.$id || '').toLowerCase() === key
      || email === key
      || (email !== '' && email.split('@')[0] === key);
  });
}
