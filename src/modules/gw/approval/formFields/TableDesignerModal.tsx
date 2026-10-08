import React, { useState, useRef, useEffect, useMemo } from 'react';
import type { FormField } from '@/domain/approvalForm/schema';
import { getCellMergeInfo, type CellMerge } from './utils';
import {
  X,
  Plus,
  Trash2,
  Check,
  Calculator,
  ArrowRight,
  ArrowDown,
  ArrowUp,
  Split,
  SlidersHorizontal,
  Table,
  Edit2,
  RefreshCw,
  ChevronUp,
  ChevronDown,
  GripVertical,
  Percent,
  Zap,
  Sparkles,
  MousePointerClick,
} from 'lucide-react';
import {
  recalculateTableFormulas,
  type CellFormula,
  type CellFormat,
} from './formulaEngine';
import { TableCellTextarea } from './TableCellTextarea';

export interface TableDataPayload {
  cols: string[];
  rows: Array<Record<string, string>>;
  defaultRows?: Array<Record<string, string>>;
  tableWidth: string;
  colWidths: Record<string, string>;
  merges: CellMerge[];
  headerValues: Record<string, string>;
  amountCells: Array<{ rIdx: number; col: string }>;
  sumCell: { rIdx: number; col: string } | null;
  secretCols: string[];
  secretCells: string[];
  secretRows: number[];
  cellFormulas: Record<string, CellFormula>;
}

export interface OtherTableOption {
  key: string;
  label: string;
  cols: string[];
  rows: Array<Record<string, string>>;
  headerValues?: Record<string, string>;
}

interface TableDesignerModalProps {
  isOpen: boolean;
  onClose: () => void;
  field: FormField;
  initialData: TableDataPayload;
  onApply: (data: TableDataPayload) => void;
  isDesignMode?: boolean;
  otherTables?: OtherTableOption[];
}

type CalcType = 'none' | 'column_sum' | 'percentage' | 'operation' | 'custom';

export function TableDesignerModal({
  isOpen,
  onClose,
  field,
  initialData,
  onApply,
  otherTables = [],
}: TableDesignerModalProps) {
  const [cols, setCols] = useState<string[]>(initialData.cols);
  const [rows, setRows] = useState<Array<Record<string, string>>>(initialData.rows);
  const [colWidths, setColWidths] = useState<Record<string, string>>(initialData.colWidths);
  const [merges, setMerges] = useState<CellMerge[]>(initialData.merges);
  const [headerValues, setHeaderValues] = useState<Record<string, string>>(initialData.headerValues);
  const [amountCells, setAmountCells] = useState<Array<{ rIdx: number; col: string }>>(
    initialData.amountCells || []
  );
  const [sumCell, setSumCell] = useState<{ rIdx: number; col: string } | null>(initialData.sumCell);
  const [secretCols, setSecretCols] = useState<string[]>(initialData.secretCols || []);
  const [secretCells, setSecretCells] = useState<string[]>(initialData.secretCells || []);
  const [secretRows, setSecretRows] = useState<number[]>(initialData.secretRows || []);
  const [cellFormulas, setCellFormulas] = useState<Record<string, CellFormula>>(
    initialData.cellFormulas || {}
  );

  // 동기화
  useEffect(() => {
    if (isOpen) {
      setCols(initialData.cols);
      setRows(initialData.rows);
      setColWidths(initialData.colWidths || {});
      setMerges(initialData.merges || []);
      setHeaderValues(initialData.headerValues || {});
      setAmountCells(initialData.amountCells || []);
      setSumCell(initialData.sumCell || null);
      setSecretCols(initialData.secretCols || []);
      setSecretCells(initialData.secretCells || []);
      setSecretRows(initialData.secretRows || []);
      setCellFormulas(initialData.cellFormulas || {});
      setSelectedCell(null);
      setPickingOperand(null);
    }
  }, [isOpen, initialData]);

  // 선택된 셀 상태 (rIdx, cIdx, col)
  const [selectedCell, setSelectedCell] = useState<{
    rIdx: number;
    cIdx: number;
    col: string;
  } | null>(null);

  // 연산식(A - B 등) 설정 시 표에서 직접 셀을 클릭하여 오퍼랜드로 선택하는 상태
  const [pickingOperand, setPickingOperand] = useState<'left' | 'right' | null>(null);

  // ESC 키로 셀 찍기 모드 취소
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && pickingOperand) {
        setPickingOperand(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [pickingOperand]);

  // 열 이름 변경 인라인 편집 상태
  const [editingCol, setEditingCol] = useState<string | null>(null);
  const [editingColTitle, setEditingColTitle] = useState('');

  // 열 너비 리사이징 상태
  const resizingRef = useRef<{ col: string; startX: number; startW: number } | null>(null);

  // 행 드래그 상태
  const [dragRow, setDragRow] = useState<number | null>(null);
  const [dragOverRow, setDragOverRow] = useState<number | null>(null);
  const [selectedRatioAmountCol, setSelectedRatioAmountCol] = useState<string>('');
  const [selectedRatioBaseRow, setSelectedRatioBaseRow] = useState<string>('소계');
  const [selectedRatioFormat, setSelectedRatioFormat] = useState<CellFormat>('percent1');

  const defaultAmountCol = useMemo(() => {
    return (
      cols.find((c) => (headerValues[c] || c).includes('금액')) ||
      cols[cols.length - 1] ||
      cols[0]
    );
  }, [cols, headerValues]);

  const effectiveAmountCol = selectedRatioAmountCol || defaultAmountCol;

  // 1:1 병합 정보 획득
  const getMergeInfo = (rIdx: number, cIdx: number) => getCellMergeInfo(rIdx, cIdx, merges);

  // 실시간 수식 및 합산 재계산
  const runRecalc = (
    nextCols = cols,
    nextRows = rows,
    nextFormulas = cellFormulas,
    nextHeaders = headerValues
  ) => {
    const otherTablesContext: Record<string, { cols: string[]; rows: Array<Record<string, string>>; headerValues?: Record<string, string> }> = {};
    if (otherTables && otherTables.length > 0) {
      otherTables.forEach((t) => {
        otherTablesContext[t.label] = {
          cols: t.cols,
          rows: t.rows,
          headerValues: t.headerValues,
        };
        otherTablesContext[t.key] = {
          cols: t.cols,
          rows: t.rows,
          headerValues: t.headerValues,
        };
      });
    }

    let res = recalculateTableFormulas(nextCols, nextRows, nextFormulas, nextHeaders, otherTablesContext);
    if (sumCell) {
      const copy = [...res];
      let sum = 0;
      copy.forEach((r, rIdx) => {
        nextCols.forEach((c) => {
          if (sumCell.rIdx === rIdx && sumCell.col === c) return;
          if (c.includes('금액') || amountCells.some((ac) => ac.rIdx === rIdx && ac.col === c)) {
            const num = Number(String(r[c] ?? '').replace(/[^0-9]/g, '')) || 0;
            sum += num;
          }
        });
      });
      if (copy[sumCell.rIdx]) {
        copy[sumCell.rIdx] = {
          ...copy[sumCell.rIdx],
          [sumCell.col]: sum > 0 ? String(sum) : '',
        };
      }
      res = copy;
    }
    return res;
  };

  // 셀 값 변경
  const handleCellValChange = (rIdx: number, col: string, val: string) => {
    const nextRows = rows.map((r, idx) => (idx === rIdx ? { ...r, [col]: val } : r));
    const recalculated = runRecalc(cols, nextRows, cellFormulas, headerValues);
    setRows(recalculated);
  };

  // 행 위치 재배치 (드래그 앤 드롭 또는 위/아래 이동)
  const reorderRows = (fromIdx: number, toIdx: number) => {
    if (
      fromIdx === toIdx ||
      fromIdx < 0 ||
      toIdx < 0 ||
      fromIdx >= rows.length ||
      toIdx >= rows.length
    )
      return;

    const nextRows = [...rows];
    const [moved] = nextRows.splice(fromIdx, 1);
    nextRows.splice(toIdx, 0, moved);

    // 수식 키 리매핑
    const nextFormulas: Record<string, CellFormula> = {};
    Object.entries(cellFormulas).forEach(([key, formula]) => {
      const [rStr, colName] = key.split(':');
      const r = parseInt(rStr, 10);
      let newR = r;
      if (r === fromIdx) {
        newR = toIdx;
      } else if (fromIdx < toIdx && r > fromIdx && r <= toIdx) {
        newR = r - 1;
      } else if (fromIdx > toIdx && r >= toIdx && r < fromIdx) {
        newR = r + 1;
      }
      nextFormulas[`${newR}:${colName}`] = formula;
    });
    setCellFormulas(nextFormulas);

    // 병합 정보 리매핑
    const nextMerges = merges.map((m) => {
      if (m.startRow === fromIdx) return { ...m, startRow: toIdx };
      if (fromIdx < toIdx && m.startRow > fromIdx && m.startRow <= toIdx) {
        return { ...m, startRow: m.startRow - 1 };
      }
      if (fromIdx > toIdx && m.startRow >= toIdx && m.startRow < fromIdx) {
        return { ...m, startRow: m.startRow + 1 };
      }
      return m;
    });
    setMerges(nextMerges);

    // sumCell 리매핑
    if (sumCell) {
      if (sumCell.rIdx === fromIdx) {
        setSumCell({ ...sumCell, rIdx: toIdx });
      } else if (fromIdx < toIdx && sumCell.rIdx > fromIdx && sumCell.rIdx <= toIdx) {
        setSumCell({ ...sumCell, rIdx: sumCell.rIdx - 1 });
      } else if (fromIdx > toIdx && sumCell.rIdx >= toIdx && sumCell.rIdx < fromIdx) {
        setSumCell({ ...sumCell, rIdx: sumCell.rIdx + 1 });
      }
    }

    const recalculated = runRecalc(cols, nextRows, nextFormulas, headerValues);
    setRows(recalculated);
    if (selectedCell && selectedCell.rIdx === fromIdx) {
      setSelectedCell({ ...selectedCell, rIdx: toIdx });
    }
  };

  // 행 위/아래 이동
  const moveRow = (rIdx: number, direction: 'up' | 'down') => {
    const targetIdx = direction === 'up' ? rIdx - 1 : rIdx + 1;
    if (targetIdx < 0 || targetIdx >= rows.length) return;
    reorderRows(rIdx, targetIdx);
  };

  // 행 추가 (특정 행 아래 중간 삽입 또는 맨 끝 추가)
  const addRow = (atIndex?: number) => {
    const emptyRow = cols.reduce(
      (acc: Record<string, string>, c: string) => ({ ...acc, [c]: '' }),
      {}
    );
    const nextRows = [...rows];
    const insertPos = typeof atIndex === 'number' && atIndex >= 0 ? atIndex + 1 : rows.length;
    nextRows.splice(insertPos, 0, emptyRow);

    // 수식 인덱스 시프트
    const nextFormulas: Record<string, CellFormula> = {};
    Object.entries(cellFormulas).forEach(([key, formula]) => {
      const [rStr, colName] = key.split(':');
      const r = parseInt(rStr, 10);
      if (r >= insertPos) {
        nextFormulas[`${r + 1}:${colName}`] = formula;
      } else {
        nextFormulas[key] = formula;
      }
    });
    setCellFormulas(nextFormulas);

    // 병합 인덱스 시프트
    const nextMerges = merges.map((m) => {
      if (m.startRow >= insertPos) {
        return { ...m, startRow: m.startRow + 1 };
      } else if (m.startRow < insertPos && m.startRow + m.rowSpan > insertPos) {
        return { ...m, rowSpan: m.rowSpan + 1 };
      }
      return m;
    });
    setMerges(nextMerges);

    if (sumCell && sumCell.rIdx >= insertPos) {
      setSumCell({ ...sumCell, rIdx: sumCell.rIdx + 1 });
    }

    const recalculated = runRecalc(cols, nextRows, nextFormulas, headerValues);
    setRows(recalculated);
  };

  // 행 삭제
  const deleteRow = (rIdx: number) => {
    if (rows.length <= 1) return;
    const nextRows = rows.filter((_, idx) => idx !== rIdx);
    // 삭제된 행의 수식 제거 및 인덱스 조정
    const nextFormulas: Record<string, CellFormula> = {};
    Object.entries(cellFormulas).forEach(([key, formula]) => {
      const [rStr, colName] = key.split(':');
      const r = parseInt(rStr, 10);
      if (r < rIdx) {
        nextFormulas[key] = formula;
      } else if (r > rIdx) {
        nextFormulas[`${r - 1}:${colName}`] = formula;
      }
    });
    setCellFormulas(nextFormulas);

    // 병합 정보 조정
    const nextMerges = merges
      .filter((m) => !(m.startRow === rIdx && m.rowSpan === 1))
      .map((m) => {
        if (m.startRow > rIdx) return { ...m, startRow: m.startRow - 1 };
        if (m.startRow <= rIdx && m.startRow + m.rowSpan > rIdx) {
          return { ...m, rowSpan: Math.max(1, m.rowSpan - 1) };
        }
        return m;
      });
    setMerges(nextMerges);

    if (sumCell) {
      if (sumCell.rIdx === rIdx) {
        setSumCell(null);
      } else if (sumCell.rIdx > rIdx) {
        setSumCell({ ...sumCell, rIdx: sumCell.rIdx - 1 });
      }
    }

    const recalculated = runRecalc(cols, nextRows, nextFormulas, headerValues);
    setRows(recalculated);
    setSelectedCell(null);
  };

  // 열 추가
  const addCol = (afterIdx?: number) => {
    let n = cols.length + 1;
    let newColName = `열${n}`;
    while (cols.includes(newColName)) {
      n++;
      newColName = `열${n}`;
    }
    const nextCols = [...cols];
    const insertPos = typeof afterIdx === 'number' ? afterIdx + 1 : cols.length;
    nextCols.splice(insertPos, 0, newColName);

    const nextRows = rows.map((r) => ({ ...r, [newColName]: '' }));
    const nextHeaders = { ...headerValues, [newColName]: newColName };
    setCols(nextCols);
    setHeaderValues(nextHeaders);
    setRows(nextRows);
  };

  // 열 삭제
  const deleteCol = (cIdx: number) => {
    if (cols.length <= 1) return;
    const colToDelete = cols[cIdx];
    const nextCols = cols.filter((_, idx) => idx !== cIdx);
    const nextRows = rows.map((r) => {
      const copy = { ...r };
      delete copy[colToDelete];
      return copy;
    });
    // 관련 수식 제거
    const nextFormulas: Record<string, CellFormula> = {};
    Object.entries(cellFormulas).forEach(([key, formula]) => {
      const [, colName] = key.split(':');
      if (colName !== colToDelete) {
        nextFormulas[key] = formula;
      }
    });
    setCellFormulas(nextFormulas);
    setCols(nextCols);
    setRows(nextRows);
    setSelectedCell(null);
  };

  // 열 너비 균등 맞춤
  const equalizeColWidths = () => {
    const pct = `${(100 / cols.length).toFixed(1)}%`;
    const nextWidths: Record<string, string> = {};
    cols.forEach((c) => {
      nextWidths[c] = pct;
    });
    setColWidths(nextWidths);
  };

  // 셀 병합 (우측)
  const mergeRight = (rIdx: number, cIdx: number) => {
    if (cIdx >= cols.length - 1) return;
    const current = getMergeInfo(rIdx, cIdx);
    const startR = current.isMerged && current.mergeInfo ? current.mergeInfo.startRow : rIdx;
    const startC = current.isMerged && current.mergeInfo ? current.mergeInfo.startCol : cIdx;
    const currentSpan = current.isMerged && current.mergeInfo ? current.mergeInfo.colSpan : 1;
    const currentRowSpan = current.isMerged && current.mergeInfo ? current.mergeInfo.rowSpan : 1;
    const newSpan = currentSpan + 1;

    const nextMerges = merges.filter((m) => !(m.startRow === startR && m.startCol === startC));
    nextMerges.push({
      startRow: startR,
      startCol: startC,
      rowSpan: currentRowSpan,
      colSpan: newSpan,
    });
    setMerges(nextMerges);
    setSelectedCell({
      rIdx: startR,
      cIdx: startC,
      col: cols[startC] || selectedCell?.col || '',
    });
  };

  // 셀 병합 (아래)
  const mergeDown = (rIdx: number, cIdx: number) => {
    if (rIdx >= rows.length - 1) return;
    const current = getMergeInfo(rIdx, cIdx);
    const startR = current.isMerged && current.mergeInfo ? current.mergeInfo.startRow : rIdx;
    const startC = current.isMerged && current.mergeInfo ? current.mergeInfo.startCol : cIdx;
    const currentSpan = current.isMerged && current.mergeInfo ? current.mergeInfo.rowSpan : 1;
    const currentColSpan = current.isMerged && current.mergeInfo ? current.mergeInfo.colSpan : 1;
    const newSpan = currentSpan + 1;

    const nextMerges = merges.filter((m) => !(m.startRow === startR && m.startCol === startC));
    nextMerges.push({
      startRow: startR,
      startCol: startC,
      rowSpan: newSpan,
      colSpan: currentColSpan,
    });
    setMerges(nextMerges);
    setSelectedCell({
      rIdx: startR,
      cIdx: startC,
      col: cols[startC] || selectedCell?.col || '',
    });
  };

  // 셀 병합 (위로) - 바로 위 셀 또는 머리글 병합 블록과 합치기
  const mergeUp = (rIdx: number, cIdx: number) => {
    if (rIdx < 0) return; // 머리글 행은 위로 병합 불가
    const targetRow = rIdx - 1; // 0행이면 머리글(-1)

    const aboveInfo = getMergeInfo(targetRow, cIdx);
    const currentInfo = getMergeInfo(rIdx, cIdx);

    const currentSpan = currentInfo.isStart ? currentInfo.rowSpan || 1 : 1;
    const currentColSpan = currentInfo.isStart ? currentInfo.colSpan || 1 : 1;

    // 현재 셀에 자체 병합이 등록되어 있었다면 제거
    let nextMerges = merges.filter((m) => !(m.startRow === rIdx && m.startCol === cIdx));

    if (aboveInfo.isMerged && aboveInfo.mergeInfo) {
      // 위쪽에 이미 병합 블록이 있는 경우: 해당 병합 블록의 rowSpan을 현재 셀만큼 확장
      const baseMerge = aboveInfo.mergeInfo;
      nextMerges = nextMerges.filter(
        (m) => !(m.startRow === baseMerge.startRow && m.startCol === baseMerge.startCol)
      );
      nextMerges.push({
        ...baseMerge,
        rowSpan: baseMerge.rowSpan + currentSpan,
      });
      setSelectedCell({
        rIdx: baseMerge.startRow,
        cIdx: baseMerge.startCol,
        col: cols[baseMerge.startCol] || selectedCell?.col || '',
      });
    } else {
      // 위쪽에 병합 블록이 없는 경우: targetRow부터 현재 셀까지 새로 병합 생성
      nextMerges.push({
        startRow: targetRow,
        startCol: cIdx,
        rowSpan: 1 + currentSpan,
        colSpan: currentColSpan,
      });
      setSelectedCell({
        rIdx: targetRow,
        cIdx,
        col: cols[cIdx] || selectedCell?.col || '',
      });
    }

    setMerges(nextMerges);
  };

  // 병합 해제
  const unmerge = (rIdx: number, cIdx: number) => {
    const nextMerges = merges.filter((m) => {
      const rMatch = rIdx >= m.startRow && rIdx < m.startRow + m.rowSpan;
      const cMatch = cIdx >= m.startCol && cIdx < m.startCol + m.colSpan;
      return !(rMatch && cMatch);
    });
    setMerges(nextMerges);
  };

  // 선택된 셀의 현재 수식 정보
  const selectedFormula = useMemo<CellFormula | null>(() => {
    if (!selectedCell) return null;
    const key = `${selectedCell.rIdx}:${selectedCell.col}`;
    return cellFormulas[key] || null;
  }, [selectedCell, cellFormulas]);

  // 선택된 셀의 계산 방식 분석
  const currentCalcType: CalcType = useMemo(() => {
    if (!selectedFormula || !selectedFormula.expression) return 'none';
    const expr = selectedFormula.expression.trim();
    if (
      selectedFormula.format?.startsWith('percent') ||
      expr.includes('* 100') ||
      (expr.includes('/') && (expr.includes('[소계') || expr.includes('[합계')))
    ) {
      return 'percentage';
    }
    if (expr.includes('SUM(')) return 'column_sum';
    if (expr.includes('-') || expr.includes('+') || expr.includes('*') || expr.includes('/')) {
      return 'operation';
    }
    return 'custom';
  }, [selectedFormula]);

  // 선택된 셀에 열 합산 수식 적용
  const applyColumnSum = (targetColName: string, format: CellFormat = 'currency') => {
    if (!selectedCell) return;
    const key = `${selectedCell.rIdx}:${selectedCell.col}`;
    const displayColTitle = headerValues[targetColName] || targetColName;
    const nextFormulas = {
      ...cellFormulas,
      [key]: {
        expression: `=SUM([${displayColTitle}])`,
        format,
      },
    };
    setCellFormulas(nextFormulas);
    const recalculated = runRecalc(cols, rows, nextFormulas, headerValues);
    setRows(recalculated);
  };

  // 선택된 셀에 비율 / 비중 수식 적용 ( ( [금액] / [소계:금액] ) * 100 )
  const applyPercentage = (
    amountColName: string,
    baseRowLabel: string = '소계',
    format: CellFormat = 'percent1'
  ) => {
    if (!selectedCell) return;
    const key = `${selectedCell.rIdx}:${selectedCell.col}`;
    const displayAmountCol = headerValues[amountColName] || amountColName;
    const nextFormulas = {
      ...cellFormulas,
      [key]: {
        expression: `=( [${displayAmountCol}] / [${baseRowLabel}:${displayAmountCol}] ) * 100`,
        format,
      },
    };
    setCellFormulas(nextFormulas);
    const recalculated = runRecalc(cols, rows, nextFormulas, headerValues);
    setRows(recalculated);
  };

  // 해당 열 전체 행에 비중 계산 일괄 적용 (1-클릭)
  const applyColumnPercentageBatch = (
    ratioColName: string,
    amountColName: string,
    baseRowLabel: string = '소계',
    format: CellFormat = 'percent1'
  ) => {
    const displayAmountCol = headerValues[amountColName] || amountColName;
    const nextFormulas = { ...cellFormulas };

    // 소계 행 인덱스 찾기
    let totalRowIdx = rows.findIndex((row) =>
      Object.values(row).some(
        (val) => typeof val === 'string' && val.trim().includes(baseRowLabel)
      )
    );
    if (totalRowIdx === -1) {
      totalRowIdx = rows.length - 1;
    }

    // 1. 소계 이전의 모든 데이터 행에 비중 계산식 적용
    for (let r = 0; r < totalRowIdx; r++) {
      nextFormulas[`${r}:${ratioColName}`] = {
        expression: `=( [${displayAmountCol}] / [${baseRowLabel}:${displayAmountCol}] ) * 100`,
        format,
      };
    }

    // 2. 소계 행의 비중 열에는 SUM(ABOVE) (100.0%) 적용
    nextFormulas[`${totalRowIdx}:${ratioColName}`] = {
      expression: '=SUM(ABOVE)',
      format,
    };

    // 3. 소계 행의 금액 열에 SUM 수식이 없다면 자동으로 SUM(ABOVE) 지정
    const amountTotalKey = `${totalRowIdx}:${amountColName}`;
    if (!nextFormulas[amountTotalKey]) {
      nextFormulas[amountTotalKey] = {
        expression: '=SUM(ABOVE)',
        format: 'currency',
      };
    }

    setCellFormulas(nextFormulas);
    const recalculated = runRecalc(cols, rows, nextFormulas, headerValues);
    setRows(recalculated);
  };

  // 선택된 셀에 연산식 적용 (A - B)
  const applyOperation = (
    op1Title: string,
    operator: string,
    op2Title: string,
    format: CellFormat = 'currency'
  ) => {
    if (!selectedCell) return;
    const key = `${selectedCell.rIdx}:${selectedCell.col}`;
    const formatOp = (token: string) => {
      const trimmed = token.trim();
      if (trimmed.startsWith('[') && (trimmed.includes('!') || trimmed.endsWith(']'))) {
        return trimmed;
      }
      return `[${headerValues[trimmed] || trimmed}]`;
    };
    const nextFormulas = {
      ...cellFormulas,
      [key]: {
        expression: `=${formatOp(op1Title)} ${operator} ${formatOp(op2Title)}`,
        format,
      },
    };
    setCellFormulas(nextFormulas);
    const recalculated = runRecalc(cols, rows, nextFormulas, headerValues);
    setRows(recalculated);
  };

  // 선택된 셀의 수식 제거 (일반 입력 셀로 복귀)
  const removeCellCalculation = () => {
    if (!selectedCell) return;
    const key = `${selectedCell.rIdx}:${selectedCell.col}`;
    const nextFormulas = { ...cellFormulas };
    delete nextFormulas[key];
    setCellFormulas(nextFormulas);
    const recalculated = runRecalc(cols, rows, nextFormulas, headerValues);
    setRows(recalculated);
  };

  // 커스텀 수식 적용
  const applyCustomExpression = (expr: string, format: CellFormat = 'currency') => {
    if (!selectedCell) return;
    const key = `${selectedCell.rIdx}:${selectedCell.col}`;
    if (!expr.trim()) {
      removeCellCalculation();
      return;
    }
    const formattedExpr = expr.trim().startsWith('=') ? expr.trim() : `=${expr.trim()}`;
    const nextFormulas = {
      ...cellFormulas,
      [key]: {
        expression: formattedExpr,
        format,
      },
    };
    setCellFormulas(nextFormulas);
    const recalculated = runRecalc(cols, rows, nextFormulas, headerValues);
    setRows(recalculated);
  };

  // 열 너비 리사이징 핸들러
  const handleResizeStart = (e: React.MouseEvent, col: string) => {
    e.stopPropagation();
    const currentW = parseFloat(colWidths[col] || '120');
    resizingRef.current = { col, startX: e.clientX, startW: isNaN(currentW) ? 120 : currentW };

    const handleMouseMove = (me: MouseEvent) => {
      if (!resizingRef.current) return;
      const diff = me.clientX - resizingRef.current.startX;
      const nextW = Math.max(50, resizingRef.current.startW + diff);
      setColWidths((prev) => ({ ...prev, [resizingRef.current!.col]: `${Math.round(nextW)}px` }));
    };

    const handleMouseUp = () => {
      resizingRef.current = null;
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  };

  // 최신 서식 마스터 구조(열, 병합, 수식 등)를 가져와 적용하되, 이미 작성된 셀 내용은 안전하게 보존
  const syncWithMasterTemplate = () => {
    if (!field.placeholder) {
      alert('서식 마스터에 등록된 기본 정보가 없습니다.');
      return;
    }

    let master: any = null;
    try {
      master = JSON.parse(field.placeholder);
    } catch {
      alert('서식 마스터 정보를 파싱할 수 없습니다.');
      return;
    }

    const masterCols: string[] =
      Array.isArray(master.cols) && master.cols.length > 0 ? master.cols : cols;
    const masterColWidths: Record<string, string> = master.colWidths || colWidths;
    const masterMerges: CellMerge[] = Array.isArray(master.merges) ? master.merges : merges;
    const masterHeaderValues: Record<string, string> = master.headerValues || headerValues;
    const masterAmountCells: Array<{ rIdx: number; col: string }> = Array.isArray(master.amountCells)
      ? master.amountCells
      : master.amountCell
      ? [master.amountCell]
      : amountCells;
    const masterSumCell: { rIdx: number; col: string } | null =
      master.sumCell !== undefined ? master.sumCell : sumCell;
    const masterSecretCols: string[] = Array.isArray(master.secretCols) ? master.secretCols : secretCols;
    const masterSecretCells: string[] = Array.isArray(master.secretCells) ? master.secretCells : secretCells;
    const masterSecretRows: number[] = Array.isArray(master.secretRows) ? master.secretRows : secretRows;
    const masterCellFormulas: Record<string, CellFormula> = master.cellFormulas || cellFormulas;

    const masterDefaultRows: Array<Record<string, string>> =
      Array.isArray(master.rows) && master.rows.length > 0
        ? master.rows
        : Array.isArray(master.defaultRows) && master.defaultRows.length > 0
        ? master.defaultRows
        : [];

    let nextRows: Array<Record<string, string>> = [];
    if (masterDefaultRows.length > 0) {
      const maxLen = Math.max(rows.length, masterDefaultRows.length);
      for (let i = 0; i < maxLen; i++) {
        const userRow = rows[i] || {};
        const mRow = masterDefaultRows[i] || {};
        const mergedRow: Record<string, string> = {};
        masterCols.forEach((c) => {
          const userVal = userRow[c];
          const mVal = mRow[c];
          if (userVal !== undefined && userVal !== '') {
            mergedRow[c] = String(userVal);
          } else if (mVal !== undefined) {
            mergedRow[c] = String(mVal);
          } else {
            mergedRow[c] = '';
          }
        });
        nextRows.push(mergedRow);
      }
    } else {
      nextRows = rows.map((r) => {
        const mergedRow: Record<string, string> = {};
        masterCols.forEach((c) => {
          mergedRow[c] = r[c] !== undefined ? String(r[c]) : '';
        });
        return mergedRow;
      });
    }

    const recalculated = runRecalc(
      masterCols,
      nextRows,
      masterCellFormulas,
      masterHeaderValues
    );

    setCols(masterCols);
    setColWidths(masterColWidths);
    setMerges(masterMerges);
    setHeaderValues(masterHeaderValues);
    setAmountCells(masterAmountCells);
    setSumCell(masterSumCell);
    setSecretCols(masterSecretCols);
    setSecretCells(masterSecretCells);
    setSecretRows(masterSecretRows);
    setCellFormulas(masterCellFormulas);
    setRows(recalculated);
    setSelectedCell(null);

    alert('최신 서식 구조(열, 병합, 수식)가 적용되었습니다.\n작성하신 셀 내용은 안전하게 보존되었습니다.');
  };

  // 최종 적용
  const handleApply = () => {
    const finalRecalculated = runRecalc(cols, rows, cellFormulas, headerValues);
    onApply({
      cols,
      rows: finalRecalculated,
      defaultRows: finalRecalculated,
      tableWidth: '100%',
      colWidths,
      merges,
      headerValues,
      amountCells,
      sumCell,
      secretCols,
      secretCells,
      secretRows,
      cellFormulas,
    });
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in duration-200">
      <div className="relative flex flex-col w-full max-w-5xl h-[calc(88vh/var(--font-scale,1))] rounded-2xl bg-white shadow-2xl border border-border overflow-hidden">
        {/* 1. 모달 헤더 */}
        <div className="flex items-center justify-between border-b border-border bg-panel px-6 py-3.5 shrink-0">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-teal-soft/80 text-teal">
              <Table className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-[15px] font-bold text-ink">표 양식 및 수식 편집기</h3>
                <span className="rounded bg-teal/10 px-2 py-0.5 text-[10px] font-bold text-teal">
                  실물 위지윅 1:1 동기화
                </span>
              </div>
              <p className="text-[11.5px] text-ink3">
                문서 캔버스와 100% 동일한 실물 표에서 열·행 구조, 셀 병합, 자동 합산(SUM)을 직관적으로 설정합니다.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl p-1.5 text-ink3 hover:bg-panel-alt hover:text-ink transition-colors cursor-pointer"
            title="닫기"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* 2. 상단 열 & 행 빠른 관리 툴바 */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-panel-alt/50 px-6 py-2 shrink-0 text-[11.5px]">
          {/* 열/행 추가 버튼 */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => addCol()}
              className="flex items-center gap-1 rounded-lg border border-border bg-white px-2.5 py-1 text-[11px] font-semibold text-ink hover:border-teal hover:text-teal transition-colors cursor-pointer shadow-2xs"
            >
              <Plus className="h-3 w-3" />
              <span>열 추가</span>
            </button>
            <button
              type="button"
              onClick={() => addRow()}
              className="flex items-center gap-1 rounded-lg border border-border bg-white px-2.5 py-1 text-[11px] font-semibold text-ink hover:border-teal hover:text-teal transition-colors cursor-pointer shadow-2xs"
            >
              <Plus className="h-3 w-3" />
              <span>행 추가</span>
            </button>
            <button
              type="button"
              onClick={equalizeColWidths}
              className="flex items-center gap-1 rounded-lg border border-border bg-white px-2.5 py-1 text-[11px] font-semibold text-ink hover:border-teal hover:text-teal transition-colors cursor-pointer shadow-2xs"
              title="모든 열 너비를 화면에 맞춰 균등 배분합니다"
            >
              <RefreshCw className="h-3 w-3" />
              <span>열 너비 균등 맞춤</span>
            </button>
            {field.placeholder && (
              <button
                type="button"
                onClick={syncWithMasterTemplate}
                className="flex items-center gap-1 rounded-lg border border-teal/40 bg-teal-soft/30 px-2.5 py-1 text-[11px] font-bold text-teal hover:bg-teal hover:text-white transition-colors cursor-pointer shadow-2xs"
                title="서식 마스터의 최신 구조(열, 병합, 수식)를 불러와 적용합니다. 이미 작성된 셀 내용은 안전하게 보존됩니다."
              >
                <Sparkles className="h-3 w-3" />
                <span>최신 서식 양식 적용 (내용 유지)</span>
              </button>
            )}
          </div>

          {/* 셀 도구 (선택된 셀이 있을 때 활성화) */}
          {selectedCell && (
            <div className="flex items-center gap-1.5 bg-teal-soft/20 px-2.5 py-1 rounded-lg border border-teal/30 text-[11px]">
              <span className="font-bold text-teal mr-1">
                선택: {selectedCell.rIdx === -1 ? '머리글' : `${selectedCell.rIdx + 1}행`} / {headerValues[selectedCell.col] || selectedCell.col}
              </span>
              <button
                type="button"
                onClick={() => mergeUp(selectedCell.rIdx, selectedCell.cIdx)}
                disabled={selectedCell.rIdx < 0}
                className="flex items-center gap-0.5 rounded px-1.5 py-0.5 font-medium hover:bg-teal hover:text-white transition-colors cursor-pointer text-ink disabled:opacity-30"
                title="위 셀(또는 머리글)과 세로 병합"
              >
                <ArrowUp className="h-3 w-3" />
                <span>위로 병합</span>
              </button>
              <button
                type="button"
                onClick={() => mergeDown(selectedCell.rIdx, selectedCell.cIdx)}
                disabled={selectedCell.rIdx >= rows.length - 1}
                className="flex items-center gap-0.5 rounded px-1.5 py-0.5 font-medium hover:bg-teal hover:text-white transition-colors cursor-pointer text-ink disabled:opacity-30"
                title="아래 셀과 세로 병합"
              >
                <ArrowDown className="h-3 w-3" />
                <span>아래 병합</span>
              </button>
              <button
                type="button"
                onClick={() => mergeRight(selectedCell.rIdx, selectedCell.cIdx)}
                disabled={selectedCell.cIdx >= cols.length - 1}
                className="flex items-center gap-0.5 rounded px-1.5 py-0.5 font-medium hover:bg-teal hover:text-white transition-colors cursor-pointer text-ink disabled:opacity-30"
                title="오른쪽 셀과 가로 병합"
              >
                <ArrowRight className="h-3 w-3" />
                <span>우측 병합</span>
              </button>
              <button
                type="button"
                onClick={() => unmerge(selectedCell.rIdx, selectedCell.cIdx)}
                className="flex items-center gap-0.5 rounded px-1.5 py-0.5 font-medium hover:bg-panel hover:text-rose-600 transition-colors cursor-pointer text-ink3"
                title="병합 해제"
              >
                <Split className="h-3 w-3" />
                <span>해제</span>
              </button>

              {selectedCell.rIdx >= 0 && (
                <>
                  <div className="h-3.5 w-px bg-teal/30 mx-1" />

                  {/* 행 위치 변경 및 중간 삽입 도구 */}
                  <button
                    type="button"
                    onClick={() => moveRow(selectedCell.rIdx, 'up')}
                    disabled={selectedCell.rIdx === 0}
                    className="flex items-center gap-0.5 rounded px-1.5 py-0.5 font-medium hover:bg-teal hover:text-white transition-colors cursor-pointer text-ink disabled:opacity-30"
                    title="이 행을 위로 한 칸 이동"
                  >
                    <ChevronUp className="h-3 w-3" />
                    <span>위로</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => moveRow(selectedCell.rIdx, 'down')}
                    disabled={selectedCell.rIdx === rows.length - 1}
                    className="flex items-center gap-0.5 rounded px-1.5 py-0.5 font-medium hover:bg-teal hover:text-white transition-colors cursor-pointer text-ink disabled:opacity-30"
                    title="이 행을 아래로 한 칸 이동"
                  >
                    <ChevronDown className="h-3 w-3" />
                    <span>아래로</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => addRow(selectedCell.rIdx)}
                    className="flex items-center gap-0.5 rounded px-1.5 py-0.5 font-medium text-teal hover:bg-teal hover:text-white transition-colors cursor-pointer"
                    title="선택한 행 바로 아래에 새 행 삽입"
                  >
                    <Plus className="h-3 w-3" />
                    <span>아래 행 삽입</span>
                  </button>
                  {rows.length > 1 && (
                    <button
                      type="button"
                      onClick={() => deleteRow(selectedCell.rIdx)}
                      className="flex items-center gap-0.5 rounded px-1.5 py-0.5 font-medium text-rose-500 hover:bg-rose-500 hover:text-white transition-colors cursor-pointer ml-1"
                      title="이 행 전체 삭제"
                    >
                      <Trash2 className="h-3 w-3" />
                      <span>행 삭제</span>
                    </button>
                  )}
                </>
              )}
            </div>
          )}
        </div>

        {/* 3. 실물 1:1 위지윅 표 캔버스 */}
        {pickingOperand && (
          <div className="flex items-center justify-between px-6 py-2 bg-amber-500 text-white text-[11.5px] font-bold shadow-xs shrink-0 animate-in fade-in duration-150">
            <div className="flex items-center gap-2">
              <MousePointerClick className="h-4 w-4 animate-bounce" />
              <span>
                🎯 [<strong>{pickingOperand === 'left' ? '첫 번째 값(A)' : '두 번째 값(B)'}</strong>]으로 사용할 셀을 아래 표에서 직접 클릭하세요! (병합 셀, 수식 셀 등 모두 가능)
              </span>
            </div>
            <button
              type="button"
              onClick={() => setPickingOperand(null)}
              className="px-2.5 py-0.5 rounded bg-black/20 hover:bg-black/30 text-[10.5px] text-white transition-colors cursor-pointer"
            >
              선택 취소 (ESC)
            </button>
          </div>
        )}
        <div className="flex-1 overflow-auto p-6 bg-[#f8fafc]">
          <div className="rounded-xl border border-[#ccc] bg-white shadow-sm overflow-hidden inline-block min-w-full">
            <table className="w-full table-fixed border-collapse text-left text-[11.5px] border-none">
              <colgroup>
                <col style={{ width: '56px' }} />
                {cols.map((col, cIdx) => (
                  <col key={cIdx} style={{ width: colWidths[col] || `${(100 / cols.length).toFixed(1)}%` }} />
                ))}
              </colgroup>
              <tbody>
                {/* 헤더 행 (실물과 100% 동일하게 머리글 병합 적용) */}
                <tr className="border-b border-[#bbb] bg-[#f9f9f9]">
                  <th className="p-2 border border-[#eee] text-ink3 text-center text-[10.5px] font-bold w-[36px] select-none">
                    #
                  </th>
                  {cols.map((col, cIdx) => {
                    const { isMerged, isStart, rowSpan, colSpan } = getMergeInfo(-1, cIdx);
                    if (isMerged && !isStart) return null;
                    const headerTitle = headerValues[col] !== undefined ? headerValues[col] : col;
                    const isEditingThis = editingCol === col;

                    const isSelected =
                      selectedCell?.rIdx === -1 && selectedCell?.cIdx === cIdx;

                    return (
                      <th
                        key={col}
                        rowSpan={rowSpan > 1 ? rowSpan : undefined}
                        colSpan={colSpan > 1 ? colSpan : undefined}
                        onClick={() => setSelectedCell({ rIdx: -1, cIdx, col })}
                        className={`p-1.5 border border-[#eee] font-bold text-[#444] text-center relative group select-none transition-colors cursor-pointer ${
                          isSelected
                            ? 'ring-2 ring-teal ring-inset bg-teal-soft/30'
                            : 'hover:bg-teal-soft/10'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-1">
                          {isEditingThis ? (
                            <input
                              type="text"
                              value={editingColTitle}
                              onChange={(e) => setEditingColTitle(e.target.value)}
                              onBlur={() => {
                                if (editingColTitle.trim()) {
                                  setHeaderValues((prev) => ({ ...prev, [col]: editingColTitle.trim() }));
                                }
                                setEditingCol(null);
                              }}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  if (editingColTitle.trim()) {
                                    setHeaderValues((prev) => ({ ...prev, [col]: editingColTitle.trim() }));
                                  }
                                  setEditingCol(null);
                                }
                              }}
                              autoFocus
                              className="w-full rounded border border-teal bg-white px-1.5 py-0.5 text-[11px] font-bold text-teal outline-none"
                            />
                          ) : (
                            <div
                              className="flex items-center gap-1 w-full justify-center cursor-pointer"
                              onClick={() => {
                                setSelectedCell({ rIdx: -1, cIdx, col });
                              }}
                              onDoubleClick={(e) => {
                                e.stopPropagation();
                                setEditingCol(col);
                                setEditingColTitle(headerTitle);
                              }}
                              title="클릭하여 머리글 선택 (병합 등), 더블클릭 시 이름 수정"
                            >
                              <span>{headerTitle}</span>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setEditingCol(col);
                                  setEditingColTitle(headerTitle);
                                }}
                                className="p-0.5 text-ink3 hover:text-teal opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                                title="열 이름 수정"
                              >
                                <Edit2 className="h-2.5 w-2.5" />
                              </button>
                            </div>
                          )}

                          {/* 열 삭제 버튼 */}
                          {cols.length > 1 && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                deleteCol(cIdx);
                              }}
                              className="text-ink3 hover:text-rose-500 opacity-0 group-hover:opacity-100 transition-opacity p-0.5 cursor-pointer"
                              title="열 삭제"
                            >
                              <X className="h-3 w-3" />
                            </button>
                          )}
                        </div>

                        {/* 열 너비 조절 핸들 */}
                        <div
                          onMouseDown={(e) => handleResizeStart(e, col)}
                          className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-teal transition-colors"
                          title="드래그하여 열 너비 조절"
                        />
                      </th>
                    );
                  })}
                </tr>

                {/* 데이터 행 렌더링 (실물 1:1 완벽 일치 및 행 드래그 순서 변경) */}
                {rows.map((row, rIdx) => {
                  const isDragTarget = dragOverRow === rIdx && dragRow !== rIdx;
                  return (
                    <tr
                      key={rIdx}
                      onDragOver={(e) => {
                        e.preventDefault();
                        setDragOverRow(rIdx);
                      }}
                      onDrop={() => {
                        if (dragRow !== null && dragRow !== rIdx) {
                          reorderRows(dragRow, rIdx);
                        }
                        setDragRow(null);
                        setDragOverRow(null);
                      }}
                      className={`border-b border-[#eee] hover:bg-[#fafafa]/80 transition-colors ${
                        isDragTarget ? 'border-t-2 border-t-teal bg-teal-soft/20' : ''
                      } ${dragRow === rIdx ? 'opacity-40' : ''}`}
                    >
                      {/* 행 번호 & 위치 이동 핸들 & 빠른 액션 */}
                      <td className="p-1 border border-[#eee] text-center text-[10.5px] font-mono text-ink3 select-none bg-[#fafafa] relative group/row">
                        <div
                          draggable
                          onDragStart={() => setDragRow(rIdx)}
                          onDragEnd={() => {
                            setDragRow(null);
                            setDragOverRow(null);
                          }}
                          className="flex items-center justify-center gap-1 cursor-grab active:cursor-grabbing hover:text-teal font-semibold py-0.5"
                          title="드래그하여 행 순서 변경 (위/아래 이동)"
                        >
                          <GripVertical className="h-3.5 w-3.5 text-ink3 group-hover/row:text-teal" />
                          <span>{rIdx + 1}</span>
                        </div>

                        {/* 행 호버 시 나타나는 빠른 액션 툴바 (위/아래 이동, 중간 행 추가, 행 삭제) */}
                        <div className="absolute left-full top-1/2 -translate-y-1/2 z-30 hidden group-hover/row:flex items-center gap-0.5 bg-white border border-border shadow-lg rounded-lg px-1.5 py-0.5 ml-1">
                          <button
                            type="button"
                            onClick={() => moveRow(rIdx, 'up')}
                            disabled={rIdx === 0}
                            className="p-1 hover:bg-teal-soft/50 hover:text-teal rounded text-ink disabled:opacity-20 cursor-pointer"
                            title="행 위로 이동"
                          >
                            <ChevronUp className="h-3 w-3" />
                          </button>
                          <button
                            type="button"
                            onClick={() => moveRow(rIdx, 'down')}
                            disabled={rIdx === rows.length - 1}
                            className="p-1 hover:bg-teal-soft/50 hover:text-teal rounded text-ink disabled:opacity-20 cursor-pointer"
                            title="행 아래로 이동"
                          >
                            <ChevronDown className="h-3 w-3" />
                          </button>
                          <button
                            type="button"
                            onClick={() => addRow(rIdx)}
                            className="p-1 hover:bg-teal-soft/50 hover:text-teal rounded text-teal font-bold cursor-pointer"
                            title="이 행 아래에 새 행 삽입"
                          >
                            <Plus className="h-3 w-3" />
                          </button>
                          {rows.length > 1 && (
                            <button
                              type="button"
                              onClick={() => deleteRow(rIdx)}
                              className="p-1 hover:bg-rose-50 hover:text-rose-600 rounded text-rose-500 cursor-pointer"
                              title="이 행 삭제"
                            >
                              <Trash2 className="h-3 w-3" />
                            </button>
                          )}
                        </div>
                      </td>

                    {/* 열 셀 */}
                    {cols.map((col, cIdx) => {
                      const { isMerged, isStart, rowSpan, colSpan } = getMergeInfo(rIdx, cIdx);
                      if (isMerged && !isStart) return null;

                      const cellKey = `${rIdx}:${col}`;
                      const formulaInfo = cellFormulas[cellKey];
                      const hasFormula = !!formulaInfo;
                      const isSum = !!(sumCell && sumCell.rIdx === rIdx && sumCell.col === col);
                      const isCalculated = hasFormula || isSum;

                      const isSelected =
                        selectedCell?.rIdx === rIdx && selectedCell?.cIdx === cIdx;

                      const cellVal = row[col] ?? '';
                      const isPercent = typeof cellVal === 'string' && cellVal.endsWith('%');
                      const isNumLike =
                        col.includes('수량') ||
                        col.includes('단가') ||
                        col.includes('가격') ||
                        col.includes('금액') ||
                        col.includes('비용') ||
                        col.includes('비중') ||
                        col.includes('수') ||
                        col.includes('율') ||
                        isPercent ||
                        isCalculated;

                      let displayVal = cellVal;
                      if (
                        isNumLike &&
                        !isPercent &&
                        !isNaN(Number(String(cellVal).replace(/,/g, ''))) &&
                        cellVal !== ''
                      ) {
                        displayVal = Number(String(cellVal).replace(/,/g, '')).toLocaleString('ko-KR');
                      }

                      return (
                        <td
                          key={col}
                          rowSpan={rowSpan > 1 ? rowSpan : undefined}
                          colSpan={colSpan > 1 ? colSpan : undefined}
                          onClick={() => {
                            if (pickingOperand && selectedCell) {
                              const targetRow = rows[rIdx];
                              const labelCol = cols.find((c) => {
                                const val = String(targetRow?.[c] ?? '').trim();
                                return val.length > 0 && isNaN(Number(val.replace(/,/g, '')));
                              });
                              const rowLabel = labelCol ? String(targetRow[labelCol]).trim() : `${rIdx + 1}행`;
                              const colTitle = headerValues[col] || col;
                              const token = `[${rowLabel}:${colTitle}]`;

                              let currentLeft = '';
                              let currentOp = '-';
                              let currentRight = '';
                              const formulaInfo = cellFormulas[`${selectedCell.rIdx}:${selectedCell.col}`];
                              if (formulaInfo?.expression) {
                                let expr = formulaInfo.expression.trim();
                                if (expr.startsWith('=')) expr = expr.slice(1).trim();
                                const match = expr.match(/^(.+?)\s*([+\-*/])\s*(.+)$/);
                                if (match) {
                                  currentLeft = match[1].trim();
                                  currentOp = match[2];
                                  currentRight = match[3].trim();
                                }
                              }
                              const defaultLeft = cols[0] ? `[${headerValues[cols[0]] || cols[0]}]` : '';
                              const defaultRight = cols[1] ? `[${headerValues[cols[1]] || cols[1]}]` : defaultLeft;

                              const nextLeft = pickingOperand === 'left' ? token : (currentLeft || defaultLeft);
                              const nextRight = pickingOperand === 'right' ? token : (currentRight || defaultRight);
                              applyOperation(nextLeft, currentOp || '-', nextRight);
                              setPickingOperand(null);
                              return;
                            }
                            setSelectedCell({ rIdx, cIdx, col });
                          }}
                          className={`p-0 border border-[#eee] text-[#222] relative transition-all cursor-pointer ${
                            isSelected
                              ? 'ring-2 ring-teal ring-inset bg-teal-soft/25'
                              : pickingOperand
                              ? 'hover:ring-2 hover:ring-amber-500 hover:bg-amber-100/60 cursor-crosshair'
                              : isCalculated
                              ? 'bg-teal-soft/10 hover:bg-teal-soft/20'
                              : 'hover:bg-teal-soft/10'
                          }`}
                        >
                          {isCalculated ? (
                            <div className="flex items-center justify-between w-full px-2 py-1.5">
                              <span
                                className={`w-full font-bold text-teal font-mono whitespace-pre-wrap break-words ${
                                  isNumLike ? 'text-right' : 'text-left'
                                }`}
                                title={`수식: ${formulaInfo?.expression || '합계'}`}
                              >
                                {displayVal || (isNumLike ? '0' : '—')}
                              </span>
                              <span
                                className="ml-1 shrink-0 px-1 py-0.2 rounded bg-teal text-white font-mono text-[8.5px] font-extrabold shadow-2xs select-none"
                                title={`수식 설정됨: ${formulaInfo?.expression || '합계'}`}
                              >
                                fx
                              </span>
                            </div>
                          ) : (
                            <TableCellTextarea
                              value={cellVal}
                              onChange={(val) => handleCellValChange(rIdx, col, val)}
                              placeholder={isNumLike ? '0' : ''}
                              className={isNumLike ? 'text-right' : 'text-left'}
                            />
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
              </tbody>
            </table>
          </div>
        </div>

        {/* 4. 선택된 셀 전용 직관적 계산/수식 설정 카드 (하단 패널) */}
        <div className="border-t border-border bg-white px-6 py-3 shrink-0 shadow-lg">
          {selectedCell ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-teal text-white text-[10px] font-bold">
                    ✓
                  </span>
                  <span className="text-[12.5px] font-bold text-ink">
                    선택된 셀: {selectedCell.rIdx === -1 ? '머리글' : `${selectedCell.rIdx + 1}행`} / &quot;{headerValues[selectedCell.col] || selectedCell.col}&quot; 열
                  </span>
                  {(() => {
                    const mergeInfo = getMergeInfo(selectedCell.rIdx, selectedCell.cIdx);
                    if (mergeInfo.isMerged && mergeInfo.isStart) {
                      return (
                        <span className="rounded bg-indigo-50 border border-indigo-200 px-2 py-0.5 text-[10.5px] font-bold text-indigo-700">
                          {mergeInfo.rowSpan > 1 ? `${mergeInfo.rowSpan}행 ` : ''}
                          {mergeInfo.colSpan > 1 ? `${mergeInfo.colSpan}열 ` : ''}
                          병합됨
                        </span>
                      );
                    }
                    return null;
                  })()}
                  {selectedFormula && (
                    <span className="rounded bg-teal/10 px-2 py-0.5 text-[10px] font-mono font-bold text-teal">
                      현재 수식: {selectedFormula.expression}
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-3">
                  {/* 셀 병합 빠른 조작 버튼 */}
                  <div className="flex items-center gap-1 text-[11px] font-semibold text-ink2 bg-panel-alt/40 border border-border/80 px-2 py-0.5 rounded-lg">
                    <span className="text-ink3 text-[10px] font-medium mr-0.5">셀 병합:</span>
                    <button
                      type="button"
                      onClick={() => mergeUp(selectedCell.rIdx, selectedCell.cIdx)}
                      disabled={selectedCell.rIdx < 0}
                      className="flex items-center gap-0.5 rounded border border-border bg-white px-1.5 py-0.5 hover:bg-teal-soft hover:text-teal transition-colors cursor-pointer disabled:opacity-30 text-[10.5px]"
                      title="위 셀(또는 머리글)과 세로 병합"
                    >
                      <ArrowUp className="h-3 w-3" />
                      <span>위</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => mergeDown(selectedCell.rIdx, selectedCell.cIdx)}
                      disabled={selectedCell.rIdx >= rows.length - 1}
                      className="flex items-center gap-0.5 rounded border border-border bg-white px-1.5 py-0.5 hover:bg-teal-soft hover:text-teal transition-colors cursor-pointer disabled:opacity-30 text-[10.5px]"
                      title="아래 셀과 세로 병합"
                    >
                      <ArrowDown className="h-3 w-3" />
                      <span>아래</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => mergeRight(selectedCell.rIdx, selectedCell.cIdx)}
                      disabled={selectedCell.cIdx >= cols.length - 1}
                      className="flex items-center gap-0.5 rounded border border-border bg-white px-1.5 py-0.5 hover:bg-teal-soft hover:text-teal transition-colors cursor-pointer disabled:opacity-30 text-[10.5px]"
                      title="오른쪽 셀과 가로 병합"
                    >
                      <ArrowRight className="h-3 w-3" />
                      <span>우측</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => unmerge(selectedCell.rIdx, selectedCell.cIdx)}
                      className="flex items-center gap-0.5 rounded border border-border bg-white px-1.5 py-0.5 hover:bg-rose-50 hover:text-rose-600 transition-colors cursor-pointer text-ink3 text-[10.5px]"
                      title="병합 해제"
                    >
                      <Split className="h-3 w-3" />
                      <span>해제</span>
                    </button>
                  </div>

                  {/* 계산 방식 모드 탭 */}
                  <div className="flex items-center rounded-lg border border-border bg-panel-alt/60 p-0.5 text-[11px] font-semibold">
                  <button
                    type="button"
                    onClick={removeCellCalculation}
                    className={`rounded-md px-2.5 py-1 transition-colors cursor-pointer ${
                      currentCalcType === 'none'
                        ? 'bg-white text-ink shadow-2xs font-bold'
                        : 'text-ink3 hover:text-ink'
                    }`}
                  >
                    일반 입력
                  </button>
                  <button
                    type="button"
                    onClick={() => applyColumnSum(selectedCell.col)}
                    className={`flex items-center gap-1 rounded-md px-2.5 py-1 transition-colors cursor-pointer ${
                      currentCalcType === 'column_sum'
                        ? 'bg-teal text-white shadow-2xs font-bold'
                        : 'text-ink3 hover:text-ink'
                    }`}
                  >
                    <Calculator className="h-3 w-3" />
                    <span>열 합산 (SUM)</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      applyPercentage(
                        effectiveAmountCol,
                        selectedRatioBaseRow,
                        selectedRatioFormat
                      );
                    }}
                    className={`flex items-center gap-1 rounded-md px-2.5 py-1 transition-colors cursor-pointer ${
                      currentCalcType === 'percentage'
                        ? 'bg-teal text-white shadow-2xs font-bold'
                        : 'text-ink3 hover:text-ink'
                    }`}
                  >
                    <Percent className="h-3 w-3" />
                    <span>비율/비중 (%)</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const firstCol = cols[0];
                      const secondCol = cols[1] || cols[0];
                      applyOperation(
                        headerValues[firstCol] || firstCol,
                        '-',
                        headerValues[secondCol] || secondCol
                      );
                    }}
                    className={`rounded-md px-2.5 py-1 transition-colors cursor-pointer ${
                      currentCalcType === 'operation'
                        ? 'bg-teal text-white shadow-2xs font-bold'
                        : 'text-ink3 hover:text-ink'
                    }`}
                  >
                    차액/항목 연산
                  </button>
                  <button
                    type="button"
                    onClick={() => applyCustomExpression('')}
                    className={`rounded-md px-2.5 py-1 transition-colors cursor-pointer ${
                      currentCalcType === 'custom'
                        ? 'bg-teal text-white shadow-2xs font-bold'
                        : 'text-ink3 hover:text-ink'
                    }`}
                  >
                    직접 수식
                  </button>
                </div>
              </div>
            </div>

              {/* 각 계산 모드별 간편 세부 설정 옵션 */}
              {currentCalcType === 'column_sum' && (
                <div className="flex flex-wrap items-center gap-4 rounded-xl border border-teal/30 bg-teal-soft/15 px-4 py-2 text-[11.5px] animate-in fade-in duration-150">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-teal">합산할 대상 열:</span>
                    <select
                      value={
                        selectedFormula?.expression?.match(/SUM\s*\(\s*\[([^\]]+)\]\s*\)/i)?.[1] ||
                        headerValues[selectedCell.col] ||
                        selectedCell.col
                      }
                      onChange={(e) => applyColumnSum(e.target.value, selectedFormula?.format || 'currency')}
                      className="rounded border border-teal/40 bg-white px-2 py-1 text-[11.5px] font-semibold text-ink outline-none cursor-pointer"
                    >
                      {cols.map((c) => {
                        const title = headerValues[c] || c;
                        return (
                          <option key={c} value={title}>
                            {title}
                          </option>
                        );
                      })}
                    </select>
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="text-ink3 font-medium">표시 서식:</span>
                    <div className="flex items-center gap-1">
                      {(['currency', 'number', 'percent1'] as CellFormat[]).map((fmt) => (
                        <button
                          key={fmt}
                          type="button"
                          onClick={() => {
                            const curTarget =
                              selectedFormula?.expression?.match(/SUM\s*\(\s*\[([^\]]+)\]\s*\)/i)?.[1] ||
                              headerValues[selectedCell.col] ||
                              selectedCell.col;
                            applyColumnSum(curTarget, fmt);
                          }}
                          className={`rounded px-2 py-0.5 text-[10.5px] font-semibold transition-colors cursor-pointer ${
                            (selectedFormula?.format || 'currency') === fmt
                              ? 'bg-teal text-white'
                              : 'bg-white border border-border text-ink hover:bg-teal-soft'
                          }`}
                        >
                          {fmt === 'currency' ? '통화 (₩ 콤마)' : fmt === 'number' ? '일반 숫자' : '백분율 (%)'}
                        </button>
                      ))}
                    </div>
                  </div>

                  <span className="text-[10.5px] text-teal font-medium ml-auto">
                    ✓ 기안자가 입력하는 상단 데이터 행의 모든 금액이 자동으로 합산됩니다.
                  </span>
                </div>
              )}

              {currentCalcType === 'percentage' && (
                <div className="flex flex-col gap-2 rounded-xl border border-teal/30 bg-teal-soft/15 px-4 py-2.5 text-[11.5px] animate-in fade-in duration-150">
                  <div className="flex flex-wrap items-center gap-4">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-teal">분자 (금액 열):</span>
                      <select
                        value={effectiveAmountCol}
                        onChange={(e) => {
                          setSelectedRatioAmountCol(e.target.value);
                          applyPercentage(e.target.value, selectedRatioBaseRow, selectedRatioFormat);
                        }}
                        className="rounded border border-teal/40 bg-white px-2 py-1 text-[11.5px] font-semibold text-ink outline-none cursor-pointer"
                      >
                        {cols.map((c) => (
                          <option key={c} value={c}>
                            {headerValues[c] || c}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="flex items-center gap-2">
                      <span className="font-bold text-teal">분모 (기준 행):</span>
                      <select
                        value={selectedRatioBaseRow}
                        onChange={(e) => {
                          setSelectedRatioBaseRow(e.target.value);
                          applyPercentage(effectiveAmountCol, e.target.value, selectedRatioFormat);
                        }}
                        className="rounded border border-teal/40 bg-white px-2 py-1 text-[11.5px] font-semibold text-ink outline-none cursor-pointer"
                      >
                        <option value="소계">소계 행 ([소계])</option>
                        <option value="합계">합계 행 ([합계])</option>
                        <option value="LAST">마지막 행 ([LAST])</option>
                      </select>
                    </div>

                    <div className="flex items-center gap-2">
                      <span className="text-ink3 font-medium">표시 서식:</span>
                      <div className="flex items-center gap-1">
                        {(['percent1', 'percent2', 'percent'] as CellFormat[]).map((fmt) => (
                          <button
                            key={fmt}
                            type="button"
                            onClick={() => {
                              setSelectedRatioFormat(fmt);
                              applyPercentage(effectiveAmountCol, selectedRatioBaseRow, fmt);
                            }}
                            className={`rounded px-2 py-0.5 text-[10.5px] font-semibold transition-colors cursor-pointer ${
                              selectedRatioFormat === fmt
                                ? 'bg-teal text-white shadow-2xs'
                                : 'bg-white border border-border text-ink hover:bg-teal-soft'
                            }`}
                          >
                            {fmt === 'percent1' ? '소수점 1자리 (61.3%)' : fmt === 'percent2' ? '소수점 2자리 (61.33%)' : '정수 (61%)'}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-1 border-t border-teal/20">
                    <span className="text-[10.5px] text-teal font-medium">
                      💡 수식: <code>=([금액] / [{selectedRatioBaseRow}:금액]) * 100</code>
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        applyColumnPercentageBatch(
                          selectedCell.col,
                          effectiveAmountCol,
                          selectedRatioBaseRow,
                          selectedRatioFormat
                        );
                      }}
                      className="flex items-center gap-1.5 rounded-lg bg-teal px-3 py-1.5 text-[11px] font-bold text-white shadow-xs hover:bg-teal-dark hover:shadow-sm transition-all cursor-pointer"
                    >
                      <Zap className="h-3.5 w-3.5 text-amber-300 fill-amber-300" />
                      <span>⚡ 이 열(&quot;{headerValues[selectedCell.col] || selectedCell.col}&quot;) 전체 행에 비중 계산 일괄 적용</span>
                    </button>
                  </div>
                </div>
              )}

              {currentCalcType === 'operation' && (() => {
                // 현재 선택된 셀의 연산식(A - B 등) 파싱
                let parsedLeft = '';
                let parsedOp = '-';
                let parsedRight = '';
                if (selectedFormula?.expression) {
                  let expr = selectedFormula.expression.trim();
                  if (expr.startsWith('=')) expr = expr.slice(1).trim();
                  const match = expr.match(/^(.+?)\s*([+\-*/])\s*(.+)$/);
                  if (match) {
                    parsedLeft = match[1].trim();
                    parsedOp = match[2];
                    parsedRight = match[3].trim();
                  }
                }

                const currentDefaultCol = cols[0] ? `[${headerValues[cols[0]] || cols[0]}]` : '';
                const currentDefaultRight = cols[1] ? `[${headerValues[cols[1]] || cols[1]}]` : currentDefaultCol;

                const selectedLeft = parsedLeft || currentDefaultCol;
                const selectedOp = parsedOp || '-';
                const selectedRight = parsedRight || currentDefaultRight;

                // 현재 표에서 텍스트 라벨이 있거나 수식이 설정된 행들 추출
                const labeledRows = rows
                  .map((r, rIdx) => {
                    const labelCol = cols.find((c) => {
                      const val = String(r[c] ?? '').trim();
                      return val.length > 0 && isNaN(Number(val.replace(/,/g, '')));
                    });
                    const label = labelCol ? String(r[labelCol]).trim() : `${rIdx + 1}행`;
                    return { rIdx, label, row: r };
                  })
                  .filter((lr) => {
                    return (
                      lr.label !== `${lr.rIdx + 1}행` ||
                      cols.some((c) => !!cellFormulas[`${lr.rIdx}:${c}`])
                    );
                  });

                const renderOptions = (currentVal?: string) => {
                  const renderedValues = new Set<string>();

                  const addOption = (val: string, label: string) => {
                    renderedValues.add(val);
                    return (
                      <option key={val} value={val}>
                        {label}
                      </option>
                    );
                  };

                  return (
                    <>
                      {/* 1. 특정 행/셀 선택 (병합 셀, 수식 셀, 라벨 행 등) */}
                      {labeledRows.length > 0 && (
                        <optgroup label="📂 현재 표 - 특정 셀 (행/병합/수식)">
                          {labeledRows.flatMap(({ rIdx, label }) => {
                            const items: React.ReactNode[] = [];
                            cols.forEach((col, cIdx) => {
                              const { isMerged, isStart, colSpan } = getMergeInfo(rIdx, cIdx);
                              if (isMerged && !isStart) return;

                              const colTitle = headerValues[col] || col;
                              const hasFx = !!cellFormulas[`${rIdx}:${col}`];
                              const isCellMerged = isStart && colSpan > 1;

                              const mergedColTitles = isCellMerged
                                ? cols
                                    .slice(cIdx, cIdx + colSpan)
                                    .map((c) => headerValues[c] || c)
                                    .join(' + ')
                                : colTitle;

                              const val = `[${label}:${colTitle}]`;
                              const displayText = isCellMerged
                                ? `[${label}] ▸ ${mergedColTitles} (병합)${hasFx ? ' ★[fx]' : ''}`
                                : `[${label}] ▸ ${colTitle}${hasFx ? ' ★[fx]' : ''}`;

                              items.push(addOption(val, displayText));
                            });
                            return items;
                          })}
                        </optgroup>
                      )}

                      {/* 2. 현재 행 기준 열 참조 (동일 행 내 연산용) */}
                      <optgroup label="📋 현재 표 - 열 전체 (동일 행 기준)">
                        {cols.map((c) => {
                          const colTitle = headerValues[c] || c;
                          const val = `[${colTitle}]`;
                          return addOption(val, colTitle);
                        })}
                      </optgroup>

                      {/* 3. 타 표 참조 */}
                      {otherTables && otherTables.length > 0 &&
                        otherTables.map((t) => {
                          const hasSub = t.rows?.some((r) =>
                            Object.values(r).some((v) => typeof v === 'string' && v.includes('소계'))
                          );
                          const hasTotal = t.rows?.some((r) =>
                            Object.values(r).some((v) => typeof v === 'string' && v.includes('합계'))
                          );

                          const otherLabeledRows = (t.rows || [])
                            .map((r, rIdx) => {
                              const labelCol = t.cols.find((c) => {
                                const val = String(r[c] ?? '').trim();
                                return val.length > 0 && isNaN(Number(val.replace(/,/g, '')));
                              });
                              const label = labelCol ? String(r[labelCol]).trim() : '';
                              return { rIdx, label };
                            })
                            .filter((lr) => lr.label && !lr.label.includes('소계') && !lr.label.includes('합계'));

                          return (
                            <optgroup key={t.key} label={`📊 [타 표] ${t.label}`}>
                              {hasSub &&
                                t.cols.map((c) => {
                                  const colTitle = t.headerValues?.[c] || c;
                                  const val = `[${t.label}]![소계:${colTitle}]`;
                                  return addOption(val, `[${t.label}] [소계] ${colTitle}`);
                                })}
                              {hasTotal &&
                                t.cols.map((c) => {
                                  const colTitle = t.headerValues?.[c] || c;
                                  const val = `[${t.label}]![합계:${colTitle}]`;
                                  return addOption(val, `[${t.label}] [합계] ${colTitle}`);
                                })}
                              {otherLabeledRows.map(({ label }) =>
                                t.cols.map((c) => {
                                  const colTitle = t.headerValues?.[c] || c;
                                  const val = `[${t.label}]![${label}:${colTitle}]`;
                                  return addOption(val, `[${t.label}] [${label}] ${colTitle}`);
                                })
                              )}
                              {t.cols.map((c) => {
                                const colTitle = t.headerValues?.[c] || c;
                                const val = `[${t.label}]![${colTitle}]`;
                                return addOption(val, `[${t.label}] ${colTitle}`);
                              })}
                            </optgroup>
                          );
                        })}

                      {/* 현재 선택된 값이 위 옵션들에 없는 경우 (직접 입력 또는 특수 셀) */}
                      {currentVal && !renderedValues.has(currentVal) && (
                        <optgroup label="✨ 지정된 값">
                          <option value={currentVal}>{currentVal}</option>
                        </optgroup>
                      )}
                    </>
                  );
                };

                const handleOpChange = () => {
                  const leftEl = document.getElementById('op-left') as HTMLSelectElement;
                  const opEl = document.getElementById('op-symbol') as HTMLSelectElement;
                  const rightEl = document.getElementById('op-right') as HTMLSelectElement;
                  if (!leftEl || !opEl || !rightEl) return;
                  applyOperation(leftEl.value, opEl.value, rightEl.value);
                };

                return (
                  <div className="flex flex-wrap items-center gap-2 rounded-xl border border-teal/30 bg-teal-soft/15 px-4 py-2 text-[11.5px] animate-in fade-in duration-150">
                    <span className="font-bold text-teal">계산식:</span>

                    {/* A 오퍼랜드 및 셀 찍기 */}
                    <div className="flex items-center gap-1">
                      <select
                        id="op-left"
                        value={selectedLeft}
                        className="rounded border border-border bg-white px-2 py-1 text-[11.5px] font-semibold text-ink outline-none max-w-[210px]"
                        onChange={handleOpChange}
                      >
                        {renderOptions(selectedLeft)}
                      </select>
                      <button
                        type="button"
                        onClick={() => setPickingOperand(pickingOperand === 'left' ? null : 'left')}
                        className={`px-2 py-1 rounded text-[10.5px] font-bold transition-all cursor-pointer flex items-center gap-1 shrink-0 ${
                          pickingOperand === 'left'
                            ? 'bg-amber-500 text-white shadow-xs animate-pulse'
                            : 'bg-white border border-border text-ink hover:bg-panel-alt'
                        }`}
                        title="표에서 셀을 직접 클릭하여 첫 번째 값(A)으로 지정"
                      >
                        <MousePointerClick className="h-3 w-3" />
                        <span>{pickingOperand === 'left' ? '선택 중...' : '셀 찍기'}</span>
                      </button>
                    </div>

                    <select
                      id="op-symbol"
                      value={selectedOp}
                      className="rounded border border-border bg-white px-2 py-1 text-[11.5px] font-bold text-ink outline-none"
                      onChange={handleOpChange}
                    >
                      <option value="-">- (차액)</option>
                      <option value="+">+ (합산)</option>
                      <option value="*">× (곱)</option>
                      <option value="/">÷ (나눗셈)</option>
                    </select>

                    {/* B 오퍼랜드 및 셀 찍기 */}
                    <div className="flex items-center gap-1">
                      <select
                        id="op-right"
                        value={selectedRight}
                        className="rounded border border-border bg-white px-2 py-1 text-[11.5px] font-semibold text-ink outline-none max-w-[210px]"
                        onChange={handleOpChange}
                      >
                        {renderOptions(selectedRight)}
                      </select>
                      <button
                        type="button"
                        onClick={() => setPickingOperand(pickingOperand === 'right' ? null : 'right')}
                        className={`px-2 py-1 rounded text-[10.5px] font-bold transition-all cursor-pointer flex items-center gap-1 shrink-0 ${
                          pickingOperand === 'right'
                            ? 'bg-amber-500 text-white shadow-xs animate-pulse'
                            : 'bg-white border border-border text-ink hover:bg-panel-alt'
                        }`}
                        title="표에서 셀을 직접 클릭하여 두 번째 값(B)으로 지정"
                      >
                        <MousePointerClick className="h-3 w-3" />
                        <span>{pickingOperand === 'right' ? '선택 중...' : '셀 찍기'}</span>
                      </button>
                    </div>

                    <span className="text-[10.5px] text-teal font-medium ml-auto">
                      ✓ 표에서 직접 셀을 찍거나 드롭다운에서 병합/타표 셀을 선택하세요.
                    </span>
                  </div>
                );
              })()}

              {currentCalcType === 'custom' && (
                <div className="flex items-center gap-2 rounded-xl border border-teal/30 bg-teal-soft/15 px-4 py-2 text-[11.5px] animate-in fade-in duration-150">
                  <span className="font-bold text-teal">직접 수식:</span>
                  <input
                    type="text"
                    defaultValue={selectedFormula?.expression || '='}
                    onBlur={(e) => applyCustomExpression(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        applyCustomExpression((e.target as HTMLInputElement).value);
                      }
                    }}
                    placeholder="예: =SUM(ABOVE) 또는 =[매출금액] - [매입금액]"
                    className="flex-1 rounded border border-border bg-white px-2 py-1 font-mono text-[11.5px] text-ink outline-none focus:border-teal"
                  />
                  <span className="text-[10.5px] text-ink3">Enter 또는 포커스 아웃 시 적용</span>
                </div>
              )}
            </div>
          ) : (
            <div className="flex items-center justify-between text-[11.5px] text-ink3 py-1">
              <div className="flex items-center gap-2">
                <SlidersHorizontal className="h-4 w-4 text-teal" />
                <span>표 안의 셀을 클릭하면 열 합산(SUM), 차액 계산, 셀 병합 등을 직관적으로 설정할 수 있습니다.</span>
              </div>
              <span className="text-[11px] text-ink3">행/열 추가는 상단 툴바를 이용하세요.</span>
            </div>
          )}
        </div>

        {/* 5. 모달 푸터 */}
        <div className="flex items-center justify-between border-t border-border bg-panel px-6 py-3 shrink-0">
          <span className="text-[11px] text-ink3">
            [적용하기]를 누르면 변경된 표 구조와 합산 수식이 실제 문서 캔버스에 즉시 반영됩니다.
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-border bg-white px-4 py-2 text-[12px] font-bold text-ink2 hover:bg-panel-alt transition-colors cursor-pointer"
            >
              취소
            </button>
            <button
              type="button"
              onClick={handleApply}
              className="flex items-center gap-1.5 rounded-xl bg-teal px-5 py-2 text-[12px] font-bold text-white shadow-md hover:opacity-95 transition-opacity cursor-pointer"
            >
              <Check className="h-4 w-4" />
              <span>적용하기 (A4 캔버스 반영)</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
