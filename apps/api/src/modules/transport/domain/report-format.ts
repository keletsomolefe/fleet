import ExcelJS from 'exceljs';

export type ReportFormat = 'xlsx' | 'csv';
export type ReportDataset =
  | 'earnings'
  | 'activities'
  | 'expenses'
  | 'shifts'
  | 'dispatches';

export type ColumnFormat =
  | 'text'
  | 'integer'
  | 'decimal'
  | 'currency'
  | 'percent'
  | 'km';

export interface SheetColumn {
  key: string;
  header: string;
  format?: ColumnFormat;
  width?: number;
  sum?: boolean;
  wrap?: boolean;
}

export interface KpiMetric {
  label: string;
  value: string;
  numericValue?: number;
  format?: ColumnFormat;
  hint?: string;
}

export interface SheetMetadata {
  title: string;
  subtitle?: string;
  generatedAt: string;
  preparedBy: string;
  filters: Array<{ label: string; value: string }>;
  currency?: string;
}

export interface TableSheetSpec {
  name: string;
  metadata?: SheetMetadata;
  kpis?: KpiMetric[];
  sectionTitle?: string;
  columns: SheetColumn[];
  rows: Array<Record<string, string | number | boolean | null | undefined>>;
  /** Optional formula override per cell: returns ExcelJS formula string for rowNumber (1-indexed) */
  cellFormula?: (
    rowIndex: number,
    excelRowNumber: number,
    colKey: string,
    row: Record<string, string | number | boolean | null | undefined>,
  ) => string | null;
  showTotals?: boolean;
  totalsLabel?: string;
}

export const EXCEL_CURRENCY_FMT = '"R "#,##0.00;-"R "#,##0.00;"R "0.00';
export const EXCEL_DECIMAL_FMT = '#,##0.00';
export const EXCEL_KM_FMT = '#,##0.0';
export const EXCEL_INT_FMT = '#,##0';
export const EXCEL_PERCENT_FMT = '0.0%';

const FORMULA_PREFIX = /^[=+\-@\t\r]/;

export function formatSastDateTime(iso: string | Date | null | undefined): string {
  if (!iso) return '';
  const date = iso instanceof Date ? iso : new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Johannesburg',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const byType = new Map(parts.map((p) => [p.type, p.value]));
  return `${byType.get('year')}-${byType.get('month')}-${byType.get('day')} ${byType.get('hour')}:${byType.get('minute')}`;
}

export function formatZarText(value: number | string | null | undefined): string {
  const num = Number(value ?? 0);
  if (!Number.isFinite(num)) return 'R 0.00';
  const sign = num < 0 ? '-' : '';
  const abs = Math.abs(num).toLocaleString('en-ZA', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${sign}R ${abs}`;
}

export function sanitizeCsvCell(
  value: string | number | boolean | null | undefined,
): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') {
    return Number.isFinite(value) ? String(value) : '';
  }
  if (typeof value === 'boolean') {
    return value ? 'Yes' : 'No';
  }
  let text = String(value);
  // Neutralize spreadsheet formula injection (OWASP / Google export standard).
  if (FORMULA_PREFIX.test(text)) {
    text = `'${text}`;
  }
  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

export function buildCsvBuffer(
  columns: SheetColumn[],
  rows: Array<Record<string, string | number | boolean | null | undefined>>,
): Buffer {
  const headerLine = columns.map((c) => sanitizeCsvCell(c.header)).join(',');
  const dataLines = rows.map((row) =>
    columns.map((c) => sanitizeCsvCell(row[c.key])).join(','),
  );
  // UTF-8 BOM ensures Microsoft Excel opens ZAR/UTF-8 text cleanly without mojibake.
  return Buffer.from(`\uFEFF${[headerLine, ...dataLines].join('\r\n')}\r\n`, 'utf8');
}

export function excelColumnLetter(index1Based: number): string {
  let n = index1Based;
  let result = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    result = String.fromCharCode(65 + rem) + result;
    n = Math.floor((n - 1) / 26);
  }
  return result;
}

export function buildReportFilename(
  dataset: ReportDataset,
  format: ReportFormat,
  scopeTag: string,
): string {
  const safeScope = scopeTag
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  const slugMap: Record<ReportDataset, string> = {
    earnings: 'vhh-fleet-earnings',
    activities: 'vhh-fleet-driver-activity',
    expenses: 'vhh-fleet-expenses',
    shifts: 'vhh-fleet-shifts-mileage',
    dispatches: 'vhh-fleet-dispatches',
  };
  return `${slugMap[dataset]}${safeScope ? `-${safeScope}` : ''}.${format}`;
}

function numFormatFor(format?: ColumnFormat): string | undefined {
  switch (format) {
    case 'currency':
      return EXCEL_CURRENCY_FMT;
    case 'decimal':
      return EXCEL_DECIMAL_FMT;
    case 'km':
      return EXCEL_KM_FMT;
    case 'integer':
      return EXCEL_INT_FMT;
    case 'percent':
      return EXCEL_PERCENT_FMT;
    default:
      return undefined;
  }
}

function isNumericFormat(format?: ColumnFormat): boolean {
  return (
    format === 'currency' ||
    format === 'decimal' ||
    format === 'km' ||
    format === 'integer' ||
    format === 'percent'
  );
}

function sanitizeSheetName(name: string): string {
  return name.replace(/[\\/*?:[\]]/g, ' ').trim().slice(0, 31) || 'Report';
}

export async function buildExcelWorkbook(
  sheets: TableSheetSpec[],
  creator: string,
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = creator || 'VHH Fleet';
  workbook.created = new Date();
  workbook.modified = new Date();
  workbook.company = 'VHH Fleet';

  const hairline: Partial<ExcelJS.Border> = {
    style: 'thin',
    color: { argb: 'FFE5E5E5' },
  };
  const totalTop: Partial<ExcelJS.Border> = {
    style: 'medium',
    color: { argb: 'FF111111' },
  };
  const totalBottom: Partial<ExcelJS.Border> = {
    style: 'double',
    color: { argb: 'FF111111' },
  };

  for (const spec of sheets) {
    const ws = workbook.addWorksheet(sanitizeSheetName(spec.name), {
      properties: { defaultRowHeight: 20 },
      pageSetup: {
        orientation: 'landscape',
        paperSize: 9, // A4
        fitToPage: true,
        fitToWidth: 1,
        fitToHeight: 0,
      },
    });
    ws.views = [{ showGridLines: true }];

    const colCount = Math.max(spec.columns.length, 4);
    let cursorRow = 1;

    // 1. Optional Executive Metadata Banner
    if (spec.metadata) {
      const m = spec.metadata;
      const brandRow = ws.getRow(cursorRow);
      brandRow.getCell(1).value = 'VHH FLEET · MANAGEMENT REPORT';
      brandRow.getCell(1).font = {
        name: 'Calibri',
        size: 9,
        bold: true,
        color: { argb: 'FF595959' },
      };
      ws.mergeCells(cursorRow, 1, cursorRow, colCount);
      brandRow.height = 16;
      cursorRow += 1;

      const titleRow = ws.getRow(cursorRow);
      titleRow.getCell(1).value = m.title;
      titleRow.getCell(1).font = {
        name: 'Calibri',
        size: 16,
        bold: true,
        color: { argb: 'FF111111' },
      };
      ws.mergeCells(cursorRow, 1, cursorRow, colCount);
      titleRow.height = 26;
      cursorRow += 1;

      if (m.subtitle) {
        const subRow = ws.getRow(cursorRow);
        subRow.getCell(1).value = m.subtitle;
        subRow.getCell(1).font = {
          name: 'Calibri',
          size: 10,
          color: { argb: 'FF595959' },
        };
        ws.mergeCells(cursorRow, 1, cursorRow, colCount);
        subRow.height = 18;
        cursorRow += 1;
      }

      const metaParts = [
        `Generated: ${formatSastDateTime(m.generatedAt)} SAST`,
        `Prepared by: ${m.preparedBy}`,
        ...(m.currency ? [`Currency: ${m.currency}`] : []),
      ];
      const metaRow = ws.getRow(cursorRow);
      metaRow.getCell(1).value = metaParts.join('   |   ');
      metaRow.getCell(1).font = {
        name: 'Calibri',
        size: 9,
        color: { argb: 'FF666666' },
      };
      ws.mergeCells(cursorRow, 1, cursorRow, colCount);
      metaRow.height = 18;
      cursorRow += 1;

      const filterText = m.filters.length
        ? m.filters.map((f) => `${f.label}: ${f.value}`).join('   ·   ')
        : 'All records (no filters applied)';
      const filterRow = ws.getRow(cursorRow);
      filterRow.getCell(1).value = `Active filters: ${filterText}`;
      filterRow.getCell(1).font = {
        name: 'Calibri',
        size: 9,
        italic: true,
        color: { argb: 'FF404040' },
      };
      filterRow.getCell(1).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFF5F5F5' },
      };
      ws.mergeCells(cursorRow, 1, cursorRow, colCount);
      filterRow.height = 20;
      cursorRow += 2; // blank breathing row
    }

    // 2. Optional KPI Strip (4 KPI tiles per row, 2 rows tall: label + value)
    if (spec.kpis && spec.kpis.length > 0) {
      const perRow = Math.min(4, Math.max(2, spec.columns.length));
      for (let i = 0; i < spec.kpis.length; i += perRow) {
        const slice = spec.kpis.slice(i, i + perRow);
        const labelRow = ws.getRow(cursorRow);
        const valueRow = ws.getRow(cursorRow + 1);
        labelRow.height = 17;
        valueRow.height = 24;

        slice.forEach((kpi, idx) => {
          const col = idx + 1;
          const lc = labelRow.getCell(col);
          lc.value = kpi.label.toUpperCase();
          lc.font = {
            name: 'Calibri',
            size: 8,
            bold: true,
            color: { argb: 'FF595959' },
          };
          lc.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFF8F8F8' },
          };
          lc.border = { top: hairline, left: hairline, right: hairline };
          lc.alignment = { vertical: 'bottom', horizontal: 'left' };

          const vc = valueRow.getCell(col);
          if (kpi.numericValue !== undefined && Number.isFinite(kpi.numericValue)) {
            vc.value = kpi.numericValue;
            const nf = numFormatFor(kpi.format);
            if (nf) vc.numFmt = nf;
          } else {
            vc.value = kpi.value;
          }
          vc.font = {
            name: 'Calibri',
            size: 12,
            bold: true,
            color: { argb: 'FF111111' },
          };
          vc.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFF8F8F8' },
          };
          vc.border = { bottom: hairline, left: hairline, right: hairline };
          vc.alignment = { vertical: 'middle', horizontal: 'left' };
        });

        cursorRow += 3; // KPI tile pair + spacer
      }
    }

    // 3. Optional Section Heading
    if (spec.sectionTitle) {
      const secRow = ws.getRow(cursorRow);
      secRow.getCell(1).value = spec.sectionTitle;
      secRow.getCell(1).font = {
        name: 'Calibri',
        size: 11,
        bold: true,
        color: { argb: 'FF111111' },
      };
      ws.mergeCells(cursorRow, 1, cursorRow, colCount);
      secRow.height = 22;
      cursorRow += 1;
    }

    // 4. Table Header Row
    const headerRowNum = cursorRow;
    const headerRow = ws.getRow(headerRowNum);
    headerRow.height = 26;
    spec.columns.forEach((col, idx) => {
      const cell = headerRow.getCell(idx + 1);
      cell.value = col.header;
      cell.font = {
        name: 'Calibri',
        size: 10,
        bold: true,
        color: { argb: 'FFFFFFFF' },
      };
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF111111' },
      };
      cell.alignment = {
        vertical: 'middle',
        horizontal: isNumericFormat(col.format) ? 'right' : 'left',
        wrapText: true,
      };
      cell.border = {
        top: { style: 'thin', color: { argb: 'FF111111' } },
        bottom: { style: 'thin', color: { argb: 'FF111111' } },
      };
    });
    cursorRow += 1;

    const firstDataRow = cursorRow;

    // 5. Data Rows
    spec.rows.forEach((dataRow, rIdx) => {
      const excelRowNum = cursorRow;
      const row = ws.getRow(excelRowNum);
      row.height = 20;
      const isZebra = rIdx % 2 === 1;

      spec.columns.forEach((col, cIdx) => {
        const cell = row.getCell(cIdx + 1);
        const rawValue = dataRow[col.key];
        const formula = spec.cellFormula?.(rIdx, excelRowNum, col.key, dataRow);

        if (formula) {
          cell.value = {
            formula,
            result: typeof rawValue === 'number' ? rawValue : undefined,
          };
        } else if (rawValue === null || rawValue === undefined) {
          cell.value = '';
        } else if (typeof rawValue === 'boolean') {
          cell.value = rawValue ? 'Yes' : 'No';
        } else {
          cell.value = rawValue;
        }

        const nf = numFormatFor(col.format);
        if (nf && (typeof rawValue === 'number' || formula)) {
          cell.numFmt = nf;
        }

        cell.font = {
          name: 'Calibri',
          size: 10,
          color: { argb: 'FF111111' },
        };
        if (isZebra) {
          cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFF8F8F8' },
          };
        }
        cell.alignment = {
          vertical: 'middle',
          horizontal: isNumericFormat(col.format) ? 'right' : 'left',
          wrapText: Boolean(col.wrap),
        };
        cell.border = {
          bottom: hairline,
          left: hairline,
          right: hairline,
        };
      });

      cursorRow += 1;
    });

    const lastDataRow = cursorRow - 1;

    // 6. Optional Live Excel Totals Row (`=SUM(...)`)
    if (spec.showTotals && spec.rows.length > 0) {
      const totalRow = ws.getRow(cursorRow);
      totalRow.height = 24;
      spec.columns.forEach((col, cIdx) => {
        const cell = totalRow.getCell(cIdx + 1);
        const letter = excelColumnLetter(cIdx + 1);

        if (cIdx === 0) {
          cell.value = spec.totalsLabel ?? `Total (${spec.rows.length})`;
        } else if (col.sum) {
          const sumResult = spec.rows.reduce((acc, r) => {
            const v = r[col.key];
            return acc + (typeof v === 'number' && Number.isFinite(v) ? v : 0);
          }, 0);
          cell.value = {
            formula: `SUM(${letter}${firstDataRow}:${letter}${lastDataRow})`,
            result: Number(sumResult.toFixed(4)),
          };
          const nf = numFormatFor(col.format);
          if (nf) cell.numFmt = nf;
        } else {
          cell.value = '';
        }

        cell.font = {
          name: 'Calibri',
          size: 10,
          bold: true,
          color: { argb: 'FF111111' },
        };
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFF2F2F2' },
        };
        cell.alignment = {
          vertical: 'middle',
          horizontal: isNumericFormat(col.format) ? 'right' : 'left',
        };
        cell.border = {
          top: totalTop,
          bottom: totalBottom,
          left: hairline,
          right: hairline,
        };
      });
      cursorRow += 1;
    }

    // 7. AutoFilter + Frozen Header Pane
    if (spec.columns.length > 0) {
      ws.autoFilter = {
        from: { row: headerRowNum, column: 1 },
        to: {
          row: Math.max(headerRowNum, lastDataRow),
          column: spec.columns.length,
        },
      };
      ws.views = [
        {
          state: 'frozen',
          ySplit: headerRowNum,
          showGridLines: true,
        },
      ];
    }

    // 8. Auto-fit Column Widths (prevent `###` truncation in Excel)
    spec.columns.forEach((col, cIdx) => {
      if (col.width) {
        ws.getColumn(cIdx + 1).width = col.width;
        return;
      }
      let maxLen = col.header.length;
      for (const row of spec.rows.slice(0, 200)) {
        const val = row[col.key];
        const len =
          val === null || val === undefined
            ? 0
            : col.format === 'currency'
              ? `R ${Number(val).toFixed(2)}`.length + 4
              : String(val).length;
        if (len > maxLen) maxLen = len;
      }
      ws.getColumn(cIdx + 1).width = Math.min(44, Math.max(12, maxLen + 4));
    });
  }

  const arrayBuffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}
