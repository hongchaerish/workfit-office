/** 알림 저장소의 웹 주소를 모바일에서 제공하는 화면으로 연결한다. */
export function mobileNotificationLink(link: string | null | undefined): string | null {
  if (!link?.startsWith('/') || link.startsWith('//')) return null;
  try {
    const url = new URL(link, 'https://workfit.local');
    if (url.origin !== 'https://workfit.local') return null;
    if (url.pathname === '/gw/approval') {
      const docId = url.searchParams.get('doc');
      return docId ? `/m/approval/${encodeURIComponent(docId)}` : '/m/approval';
    }
    const path = url.pathname.replace(/^\/gw(?=\/|$)/, '/m');
    const target = path === '/m/work-plan' ? '/m/task' : path;
    if (!/^\/m(?:\/|$)/.test(target)) return null;
    return `${target}${url.search}${url.hash}`;
  } catch {
    return null;
  }
}
