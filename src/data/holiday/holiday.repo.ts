import type { Holiday, HolidayType } from '@/domain/holiday/schema';
import { createCrudBackend } from '@/data/_backend/crudBackend';
import { safeDocId } from '@/shared/lib/appwrite';

import { KOREA_STANDARD_HOLIDAYS } from '@/domain/holiday/koreaHolidays';

const STORAGE_KEY = 'workfit_holidays_v2';

export const INITIAL_HOLIDAYS: Holiday[] = (KOREA_STANDARD_HOLIDAYS['2026'] || []).map((item) => ({
  id: `hol-${item.date.replace(/-/g, '')}`,
  date: item.date,
  name: item.name,
  type: item.type,
  isPaid: item.isPaid,
  isRecurring: item.isRecurring ?? false,
  memo: item.memo,
  createdAt: '2026-01-01T00:00:00.000Z',
}));

interface RawHolidayDoc {
  $id?: string;
  id?: string;
  name?: string;
  type?: string;
  isPaid?: boolean;
  recurring?: boolean;
  isRecurring?: boolean;
  memo?: string;
  date?: string;
  monthDay?: string;
  $createdAt?: string;
  createdAt?: string;
  $updatedAt?: string;
  updatedAt?: string;
}

const backend = createCrudBackend<Holiday>({
  coll: 'holidays',
  parse: (raw: any): Holiday | null => {
    if (!raw) return null;
    const doc = raw as RawHolidayDoc;
    const id = doc.$id || doc.id || `hol-${Date.now()}`;
    const name = doc.name || '공휴일';
    const type = (doc.type as HolidayType) || 'legal';
    const isPaid = doc.isPaid !== undefined && doc.isPaid !== null ? Boolean(doc.isPaid) : true;
    const isRecurring = Boolean(doc.recurring ?? doc.isRecurring ?? false);
    const memo = doc.memo || undefined;

    let date = doc.date;
    if (!date && doc.monthDay) {
      date = `2026-${doc.monthDay}`;
    }
    if (!date) return null;

    return {
      id,
      date,
      name,
      type,
      isPaid,
      isRecurring,
      memo,
      createdAt: doc.$createdAt || doc.createdAt,
      updatedAt: doc.$updatedAt || doc.updatedAt,
    };
  },
  idOf: (item) => safeDocId(item.id),
  seed: INITIAL_HOLIDAYS,
  stripFields: ['id', 'isPaid', 'isRecurring', 'type', 'memo', 'createdAt', 'updatedAt'],
});

export class HolidayRepo {
  async list(year?: string): Promise<Holiday[]> {
    let dbItems: Holiday[] = [];
    try {
      dbItems = await backend.loadAll();
    } catch (e) {
      console.warn('[HolidayRepo] Appwrite holidays DB 로드 실패:', e);
    }

    const currentYear = year && year !== 'all' ? year : '2026';

    // 매년 반복(isRecurring) 공휴일은 요청된 연도에 맞게 날짜(date)를 동적으로 조정
    let result: Holiday[] = [];
    if (!year || year === 'all') {
      // 전체 연도 조회 시 2025, 2026, 2027 3개년에 대해 반복 공휴일 확장 표시
      const expanded: Holiday[] = [];
      for (const item of dbItems) {
        if (item.isRecurring) {
          const monthDay = item.date.length === 10 ? item.date.slice(5) : item.date;
          for (const y of ['2025', '2026', '2027']) {
            expanded.push({
              ...item,
              id: `${item.id}-${y}`,
              date: `${y}-${monthDay}`,
            });
          }
        } else {
          expanded.push(item);
        }
      }
      result = expanded;
    } else {
      // 특정 연도 조회 시
      result = dbItems
        .map((item) => {
          if (item.isRecurring) {
            const monthDay = item.date.length === 10 ? item.date.slice(5) : item.date;
            return {
              ...item,
              date: `${currentYear}-${monthDay}`,
            };
          }
          return item;
        })
        .filter((item) => item.date.startsWith(currentYear));
    }

    result.sort((a, b) => a.date.localeCompare(b.date));

    // 브라우저 localStorage에 미러링
    try {
      if (typeof window !== 'undefined') {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(result));
      }
    } catch {
      // ignore
    }

    return result;
  }

  async get(id: string): Promise<Holiday | null> {
    const list = await this.list('all');
    return list.find((h) => h.id === id || safeDocId(h.id) === id) ?? null;
  }

  async getByDate(dateStr: string): Promise<Holiday | null> {
    const year = dateStr.slice(0, 4);
    const list = await this.list(year);
    return list.find((h) => h.date === dateStr) ?? null;
  }

  async create(data: Omit<Holiday, 'id' | 'createdAt'>): Promise<Holiday> {
    const newId = `hol-${data.date.replace(/-/g, '')}-${Math.random().toString(36).substring(2, 6)}`;
    const newHoliday: Holiday = {
      ...data,
      id: newId,
      createdAt: new Date().toISOString(),
    };

    const payload: any = {
      ...newHoliday,
      monthDay: data.date.slice(5),
      recurring: Boolean(data.isRecurring),
    };

    await backend.save(payload);
    await this.list();
    return newHoliday;
  }

  async update(id: string, patch: Partial<Omit<Holiday, 'id'>>): Promise<Holiday> {
    const existing = await this.get(id);
    if (!existing) throw new Error(`공휴일 정보를 찾을 수 없습니다: ${id}`);
    const updatedItem: Holiday = {
      ...existing,
      ...patch,
      updatedAt: new Date().toISOString(),
    };

    const payload: any = {
      ...updatedItem,
      monthDay: updatedItem.date.slice(5),
      recurring: Boolean(updatedItem.isRecurring),
    };

    await backend.save(payload);
    await this.list();
    return updatedItem;
  }

  async delete(id: string): Promise<void> {
    await backend.remove(safeDocId(id));
    await this.list();
  }

  async importKoreaHolidays(year: string = '2026'): Promise<{ importedCount: number; updatedCount: number }> {
    const { getKoreaStandardHolidays } = await import('@/domain/holiday/koreaHolidays');
    const standardList = getKoreaStandardHolidays(year);
    const existingList = await backend.loadAll().catch(() => []);

    let importedCount = 0;
    let updatedCount = 0;

    for (const item of standardList) {
      const existing = existingList.find((h) => h.date === item.date);
      if (existing) {
        // 기존 공휴일 정보 갱신
        const updated: any = {
          ...existing,
          name: item.name,
          type: item.type,
          isPaid: item.isPaid,
          isRecurring: item.isRecurring ?? false,
          memo: item.memo || existing.memo,
          recurring: Boolean(item.isRecurring),
          monthDay: item.date.slice(5),
          updatedAt: new Date().toISOString(),
        };
        await backend.save(updated);
        updatedCount++;
      } else {
        // 신규 공휴일 등록
        const newDoc: any = {
          id: `hol-${item.date.replace(/-/g, '')}`,
          date: item.date,
          name: item.name,
          type: item.type,
          isPaid: item.isPaid,
          isRecurring: item.isRecurring ?? false,
          memo: item.memo,
          recurring: Boolean(item.isRecurring),
          monthDay: item.date.slice(5),
          createdAt: new Date().toISOString(),
        };
        await backend.save(newDoc);
        importedCount++;
      }
    }

    // 캐시 및 로컬스토리지 동기화
    await this.list(year);
    return { importedCount, updatedCount };
  }

  async resetToDefault(year: string = '2026'): Promise<Holiday[]> {
    await this.importKoreaHolidays(year);
    return this.list(year);
  }
}

export const holidayRepo = new HolidayRepo();
