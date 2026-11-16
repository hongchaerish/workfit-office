/**
 * 기업 정보 입력칸 — 치는 동안 맞추는 모양과 형식 확인. 화면(CompanyFormModal)은 이 결과를 넣기만 한다.
 * 저장 값은 바뀌지 않는다: 사업자등록번호는 저장할 때 숫자만, 나머지는 보이는 그대로.
 */

const onlyDigits = (s: string) => s.replace(/\D/g, '');

/** 사업자등록번호 — 3-2-5, 숫자 10자리까지 */
export function formatBizNoTyping(raw: string): string {
  const d = onlyDigits(raw).slice(0, 10);
  if (d.length <= 3) return d;
  if (d.length <= 5) return `${d.slice(0, 3)}-${d.slice(3)}`;
  return `${d.slice(0, 3)}-${d.slice(3, 5)}-${d.slice(5)}`;
}

const join = (...parts: string[]) => parts.filter(Boolean).join('-');

/**
 * 전화·팩스 번호 — 서울(02-XXX(X)-XXXX), 휴대폰·지역·인터넷전화(0XX-XXX(X)-XXXX),
 * 대표번호(15XX·16XX·18XX-XXXX), 0505(0505-XXXX-XXXX).
 * 숫자·하이픈 외 글자(띄어쓰기, 괄호, 내선, +82 등)가 있으면 친 그대로 둔다 — 띄어쓰기를 지우면 '내선'을 붙여 칠 수 없다.
 */
export function formatPhoneTyping(raw: string): string {
  if (/[^0-9-]/.test(raw)) return raw;
  const all = onlyDigits(raw);
  if (all.startsWith('02')) {
    const d = all.slice(0, 10);
    if (d.length <= 2) return d;
    if (d.length <= 5) return join('02', d.slice(2));
    if (d.length <= 9) return join('02', d.slice(2, 5), d.slice(5));
    return join('02', d.slice(2, 6), d.slice(6));
  }
  if (all.startsWith('050')) {
    const d = all.slice(0, 12);
    if (d.length <= 4) return d;
    if (d.length <= 8) return join(d.slice(0, 4), d.slice(4));
    return join(d.slice(0, 4), d.slice(4, 8), d.slice(8));
  }
  if (all.startsWith('1')) {
    const d = all.slice(0, 8);
    return d.length <= 4 ? d : join(d.slice(0, 4), d.slice(4));
  }
  const d = all.slice(0, 11);
  if (d.length <= 3) return d;
  if (d.length <= 7) return join(d.slice(0, 3), d.slice(3));
  if (d.length <= 10) return join(d.slice(0, 3), d.slice(3, 6), d.slice(6));
  return join(d.slice(0, 3), d.slice(3, 7), d.slice(7));
}

/** 계좌번호 — 은행마다 모양이 달라 하이픈은 친 대로 두고, 숫자·하이픈 외 글자와 겹친 하이픈만 뺀다 */
export function formatAccountNoTyping(raw: string): string {
  return raw.replace(/[^0-9-]/g, '').replace(/-{2,}/g, '-');
}

/** 앞에 숫자가 n개 있던 커서를, 모양을 맞춘 글자에서 그 n번째 숫자 바로 뒤로 */
export function caretAfter(formatted: string, digitsBefore: number): number {
  if (digitsBefore <= 0) return 0;
  let seen = 0;
  for (let i = 0; i < formatted.length; i++) {
    if (/\d/.test(formatted[i]) && ++seen === digitsBefore) return i + 1;
  }
  return formatted.length;
}

/** 이메일 — 비어 있으면 통과 */
export function isValidEmail(v: string): boolean {
  const s = v.trim();
  return !s || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

/** 홈페이지 — 비어 있으면 통과. http(s):// 는 있어도 없어도 된다 */
export function isValidHomepage(v: string): boolean {
  const s = v.trim();
  if (!s) return true;
  if (/\s/.test(s)) return false;
  const host = s.replace(/^https?:\/\//i, '').split(/[/?#]/)[0];
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+(:\d+)?$/i.test(host);
}

/** 홈페이지 링크 — http(s):// 가 없으면 https:// 를 붙인다 */
export function homepageHref(v: string): string {
  const s = v.trim();
  return /^https?:\/\//i.test(s) ? s : `https://${s}`;
}
