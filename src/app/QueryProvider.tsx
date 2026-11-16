import { useState, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { applyQueryDefaults } from './queryDefaults';

/**
 * TanStack Query Provider — 서버 상태(로딩/캐싱/리페치/낙관적 업데이트) 표준화.
 * 모든 데이터 훅(features/*)이 이 컨텍스트 위에서 동작한다.
 */
export function QueryProvider({ children }: { children: ReactNode }) {
  const [client] = useState(() => {
    const qc = new QueryClient({
      defaultOptions: {
        queries: {
          staleTime: 30_000,
          refetchOnWindowFocus: false,
          retry: 1,
        },
      },
    });
    applyQueryDefaults(qc);
    return qc;
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
