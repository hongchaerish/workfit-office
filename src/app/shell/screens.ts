import { flattenScreens } from '../routes';
import type { FlatScreen } from '@/shared/types/menu';

/** 전체 화면 평면 인덱스(검색·탭·즐겨찾기 공용). */
export const SCREENS: FlatScreen[] = flattenScreens();
export const SCREEN_BY_URL: Record<string, FlatScreen> = Object.fromEntries(
  SCREENS.map((s) => [s.url, s]),
);
export const SCREEN_BY_NAME: Record<string, FlatScreen> = Object.fromEntries(
  SCREENS.map((s) => [s.name, s]),
);

export const HOME_URL = '/exec';
