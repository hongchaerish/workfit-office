import React from 'react';

// URL 시작 패턴 매칭 (http://, https:// 또는 www. 로 시작하는 문자열)
const URL_CANDIDATE_REGEX = /(https?:\/\/[^\s<>]+|www\.[^\s<>]+)/gi;

/**
 * URL 끝에 붙은 불필요한 구두점을 분리하여 정제된 URL과 후속 텍스트를 반환합니다.
 * (예: "https://naver.com.)" -> url: "https://naver.com", trailing: ".)"
 * 단, 위키피디아 등 URL 자체에 괄호가 포함된 경우(React_(software)) 괄호 쌍을 보존합니다.
 */
function extractCleanUrl(candidate: string): { cleanUrl: string; trailing: string } {
  let cleanUrl = candidate;
  let trailing = '';

  // 끝에서부터 구두점 검사 및 분리
  while (cleanUrl.length > 0) {
    const lastChar = cleanUrl[cleanUrl.length - 1];

    if (!/[.,!?;:"')\]}]/.test(lastChar)) {
      break;
    }

    // 닫는 괄호인 경우, URL 내부에 매칭되는 여는 괄호가 있는지 확인
    if (lastChar === ')') {
      const openCount = (cleanUrl.match(/\(/g) || []).length;
      const closeCount = (cleanUrl.match(/\)/g) || []).length;
      if (openCount >= closeCount) {
        break; // URL 내부의 정상적인 괄호쌍으로 판단
      }
    } else if (lastChar === ']') {
      const openCount = (cleanUrl.match(/\[/g) || []).length;
      const closeCount = (cleanUrl.match(/\]/g) || []).length;
      if (openCount >= closeCount) {
        break;
      }
    } else if (lastChar === '}') {
      const openCount = (cleanUrl.match(/\{/g) || []).length;
      const closeCount = (cleanUrl.match(/\}/g) || []).length;
      if (openCount >= closeCount) {
        break;
      }
    }

    // 구두점을 trailing으로 이동
    trailing = lastChar + trailing;
    cleanUrl = cleanUrl.slice(0, -1);
  }

  return { cleanUrl, trailing };
}

export interface AutoLinkTextProps {
  /** 렌더링할 원본 텍스트 */
  text?: string | null;
  /** 전체 컨테이너 클래스 */
  className?: string;
  /** 하이퍼링크 <a> 태그 커스텀 클래스 */
  linkClassName?: string;
  /** 링크 클릭 시 추가 동작이 필요할 경우의 콜백 (선택) */
  onLinkClick?: (url: string, e: React.MouseEvent<HTMLAnchorElement>) => void;
  /** 링크 열기 전 외부 링크 확인 알림 표시 여부 (선택, 기본값: false) */
  confirmExternal?: boolean;
}

/**
 * 텍스트 내 포함된 URL을 감지하여 안전한 <a> 태그로 자동 변환하는 공용 컴포넌트
 * - 문장 끝 구두점/괄호 자동 정제
 * - XSS 방지 (Virtual DOM 분할 렌더링)
 * - 인쇄 환경(@media print) 스타일 최적화 (파란색/밑줄 제거)
 * - 롱프레스/컨텍스트 메뉴 이벤트 전파 차단
 */
export function AutoLinkText({
  text,
  className = '',
  linkClassName = 'text-[#1890ff] hover:underline break-all font-medium transition-colors print:text-inherit print:no-underline print:font-normal print:cursor-text',
  onLinkClick,
  confirmExternal = false,
}: AutoLinkTextProps) {
  if (!text) return null;

  // 1. 줄바꿈(\n) 단위로 1차 분할하여 줄바꿈 태그(<br />) 보존
  const lines = text.split('\n');

  const handleClick = (url: string, e: React.MouseEvent<HTMLAnchorElement>) => {
    // 상위 말풍선 선택, 롱프레스, 행 선택 등의 이벤트 전파 방지
    e.stopPropagation();

    if (confirmExternal) {
      const currentHost = window.location.host;
      let targetHost = '';
      try {
        targetHost = new URL(url).host;
      } catch {
        targetHost = '';
      }

      if (targetHost && targetHost !== currentHost) {
        const proceed = window.confirm(`외부 웹사이트(${targetHost})로 이동하시겠습니까?\n\n이동 URL: ${url}`);
        if (!proceed) {
          e.preventDefault();
          return;
        }
      }
    }

    if (onLinkClick) {
      onLinkClick(url, e);
    }
  };

  return (
    <span className={className}>
      {lines.map((line, lineIdx) => {
        // 2. URL 후보를 기준으로 토큰 분할
        const parts = line.split(URL_CANDIDATE_REGEX);

        return (
          <React.Fragment key={lineIdx}>
            {lineIdx > 0 && <br />}
            {parts.map((part, partIdx) => {
              if (!part) return null;

              if (part.match(URL_CANDIDATE_REGEX)) {
                const { cleanUrl, trailing } = extractCleanUrl(part);

                if (!cleanUrl) {
                  return <React.Fragment key={partIdx}>{part}</React.Fragment>;
                }

                // http/https 프로토콜 누락 시 https:// 자동 보정
                const href = cleanUrl.startsWith('http://') || cleanUrl.startsWith('https://')
                  ? cleanUrl
                  : `https://${cleanUrl}`;

                return (
                  <React.Fragment key={partIdx}>
                    <a
                      href={href}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => handleClick(href, e)}
                      className={linkClassName}
                      title={cleanUrl}
                    >
                      {cleanUrl}
                    </a>
                    {trailing}
                  </React.Fragment>
                );
              }

              return <React.Fragment key={partIdx}>{part}</React.Fragment>;
            })}
          </React.Fragment>
        );
      })}
    </span>
  );
}

export default AutoLinkText;
