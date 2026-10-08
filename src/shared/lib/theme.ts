export interface CustomThemeSettings {
  headerBg: string;
  pointColor: string;
  btnColor: string;
  fontScale: string;
}

export const DEFAULT_THEME_SETTINGS: CustomThemeSettings = {
  headerBg: '#dbeafe',
  pointColor: '#99bbff',
  btnColor: '#1243b5',
  // 고령 사용자 가독성 의견으로 기존 1.1875에서 약 1.25배 키운 값을 기본으로 한다
  fontScale: '1.48',
};

/**
 * 배율 저장 키. 기본 배율을 1.1875 → 1.48로 올리면서 _v2로 바꿔,
 * 예전에 저장된 배율(구 기준의 작게/보통/크게)은 무시하고 모두 새 기본으로 시작하게 한다.
 */
const FONT_SCALE_KEY = 'custom_font_scale_v2';

export function getThemeKey(key: string, userId?: string): string {
  return userId ? `${key}_${userId}` : key;
}

export function getContrastColor(hexColor: string): string {
  const hex = hexColor.replace('#', '');
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6 ? '#1c2536' : '#ffffff';
}

export function getSoftColor(hexColor: string): string {
  const hex = hexColor.replace('#', '');
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);
  const nr = Math.round(r + (255 - r) * 0.85);
  const ng = Math.round(g + (255 - g) * 0.85);
  const nb = Math.round(b + (255 - b) * 0.85);
  const toHex = (n: number) => String(n.toString(16)).padStart(2, '0');
  return `#${toHex(nr)}${toHex(ng)}${toHex(nb)}`;
}

/**
 * CSS 변수로 DOM에 테마 및 폰트 적용
 */
export function applyTheme(headerBg: string, pointColor: string, btnColor: string, fontScale?: string): void {
  try {
    const headerText = getContrastColor(headerBg);
    const pointText = getContrastColor(pointColor);
    const pointSoft = getSoftColor(pointColor);
    const btnText = getContrastColor(btnColor);

    document.documentElement.style.setProperty('--color-header-bg', headerBg);
    document.documentElement.style.setProperty('--color-header-text', headerText);

    document.documentElement.style.setProperty('--color-teal-custom', pointColor);
    document.documentElement.style.setProperty('--color-teal-text', pointText);
    document.documentElement.style.setProperty('--color-teal-soft', pointSoft);

    document.documentElement.style.setProperty('--color-navy-custom', btnColor);
    document.documentElement.style.setProperty('--color-navy-text', btnText);

    if (fontScale) {
      document.documentElement.style.setProperty('--font-scale', fontScale);
    }
  } catch {
    // ignore
  }
}

/**
 * 사용자별 테마 설정 불러오기 (신규 키 우선, 없으면 레거시 전역 키 fallback)
 */
export function loadUserTheme(userId?: string): CustomThemeSettings {
  try {
    const hKey = getThemeKey('custom_theme_header_bg', userId);
    const pKey = getThemeKey('custom_theme_point_color', userId);
    const bKey = getThemeKey('custom_theme_btn_color', userId);
    const fKey = getThemeKey(FONT_SCALE_KEY, userId);

    return {
      headerBg: localStorage.getItem(hKey) ?? localStorage.getItem('custom_theme_header_bg') ?? DEFAULT_THEME_SETTINGS.headerBg,
      pointColor: localStorage.getItem(pKey) ?? localStorage.getItem('custom_theme_point_color') ?? DEFAULT_THEME_SETTINGS.pointColor,
      btnColor: localStorage.getItem(bKey) ?? localStorage.getItem('custom_theme_btn_color') ?? DEFAULT_THEME_SETTINGS.btnColor,
      fontScale: localStorage.getItem(fKey) ?? DEFAULT_THEME_SETTINGS.fontScale,
    };
  } catch {
    return { ...DEFAULT_THEME_SETTINGS };
  }
}

/**
 * 사용자별 테마 설정 저장하기
 */
export function saveUserTheme(settings: Partial<CustomThemeSettings>, userId?: string): void {
  try {
    if (settings.headerBg !== undefined) {
      localStorage.setItem(getThemeKey('custom_theme_header_bg', userId), settings.headerBg);
    }
    if (settings.pointColor !== undefined) {
      localStorage.setItem(getThemeKey('custom_theme_point_color', userId), settings.pointColor);
    }
    if (settings.btnColor !== undefined) {
      localStorage.setItem(getThemeKey('custom_theme_btn_color', userId), settings.btnColor);
    }
    if (settings.fontScale !== undefined) {
      localStorage.setItem(getThemeKey(FONT_SCALE_KEY, userId), settings.fontScale);
    }
  } catch (e) {
    console.error('Failed to save theme to localStorage:', e);
  }
}
