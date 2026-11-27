import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import {
  buildCsvBuffer,
  buildExcelWorkbook,
  buildReportFilename,
  EXCEL_CURRENCY_FMT,
  excelColumnLetter,
  formatSastDateTime,
  sanitizeCsvCell,
} from './report-format.js';

describe('report-format', () => {
  it('neutralizes spreadsheet formula injection in CSV string cells while keeping numbers numeric', () => {
    expect(sanitizeCsvCell('=SUM(A1:A5)')).toBe("'=SUM(A1:A5)");
    expect(sanitizeCsvCell('+cmd|calc')).toBe("'+cmd|calc");
    expect(sanitizeCsvCell('-2+3')).toBe("'-2+3");
    expect(sanitizeCsvCell('@HYPERLINK("http://evil")')).toBe(
      `"'@HYPERLINK(""http://evil"")"`,
    );
    expect(sanitizeCsvCell(-450.25)).toBe('-450.25');
    expect(sanitizeCsvCell('North Pit, "Gate 2"')).toBe(
      '"North Pit, ""Gate 2"""',
    );
    expect(sanitizeCsvCell(true)).toBe('Yes');
    expect(sanitizeCsvCell(null)).toBe('');
  });

  it('produces UTF-8 BOM RFC 4180 CSV buffers', () => {
    const buf = buildCsvBuffer(
      [
        { key: 'truck', header: 'Vehicle' },
        { key: 'amount', header: 'Amount (ZAR)', format: 'currency' },
        { key: 'note', header: 'Notes' },
      ],
      [{ truck: 'TRK-01', amount: 6600, note: '=1+1' }],
    );
    const text = buf.toString('utf8');
    expect(text.startsWith('\uFEFFVehicle,Amount (ZAR),Notes\r\n')).toBe(true);
    expect(text).toContain("TRK-01,6600,'=1+1\r\n");
  });

  it('builds safe filenames and SAST timestamps', () => {
    expect(buildReportFilename('earnings', 'xlsx', '2026-11 GP 123')).toBe(
      'vhh-fleet-earnings-2026-11-gp-123.xlsx',
    );
    expect(buildReportFilename('activities', 'csv', '2026-11-01-to-2026-11-30')).toBe(
      'vhh-fleet-driver-activity-2026-11-01-to-2026-11-30.csv',
    );
    expect(formatSastDateTime('2026-11-26T10:15:00.000Z')).toBe(
      '2026-11-26 12:15',
    );
    expect(excelColumnLetter(1)).toBe('A');
    expect(excelColumnLetter(26)).toBe('Z');
    expect(excelColumnLetter(27)).toBe('AA');
  });

  it('generates a multi-sheet styled Excel workbook with metadata, KPIs, AutoFilter, frozen header, and SUM formulas', async () => {
    const buffer = await buildExcelWorkbook(
      [
        {
          name: 'Executive Summary',
          metadata: {
            title: 'Monthly Truck Earnings & P&L — 2026-11',
            subtitle: 'Test report',
            generatedAt: '2026-11-26T10:00:00.000Z',
            preparedBy: 'Patrick Keletso (patrickkeletso@gmail.com)',
            filters: [{ label: 'Operational Month', value: '2026-11' }],
            currency: 'ZAR',
          },
          kpis: [
            {
              label: 'Estimated Revenue',
              value: 'R 6 600,00',
              numericValue: 6600,
              format: 'currency',
            },
            {
              label: 'Deliveries',
              value: '2',
              numericValue: 2,
              format: 'integer',
            },
          ],
          sectionTitle: 'Per-Vehicle Performance',
          columns: [
            { key: 'registration', header: 'Registration' },
            { key: 'deliveries', header: 'Deliveries', format: 'integer', sum: true },
            { key: 'revenue', header: 'Revenue (ZAR)', format: 'currency', sum: true },
          ],
          rows: [
            { registration: 'GP-100', deliveries: 1, revenue: 4000 },
            { registration: 'GP-200', deliveries: 1, revenue: 2600 },
          ],
          showTotals: true,
          totalsLabel: 'Fleet Total',
        },
        {
          name: 'By Customer',
          columns: [
            { key: 'name', header: 'Customer' },
            { key: 'amount', header: 'Revenue (ZAR)', format: 'currency', sum: true },
          ],
          rows: [{ name: 'Mining Co', amount: 6600 }],
          showTotals: true,
        },
      ],
      'Patrick Keletso',
    );

    expect(buffer.byteLength).toBeGreaterThan(3000);

    const parsed = new ExcelJS.Workbook();
    await parsed.xlsx.load(buffer as unknown as ArrayBuffer);
    expect(parsed.worksheets.map((w) => w.name)).toEqual([
      'Executive Summary',
      'By Customer',
    ]);

    const summary = parsed.getWorksheet('Executive Summary')!;
    expect(summary.getCell('A1').value).toBe('VHH FLEET · MANAGEMENT REPORT');
    expect(summary.getCell('A2').value).toBe(
      'Monthly Truck Earnings & P&L — 2026-11',
    );
    expect(summary.autoFilter).toBeTruthy();
    expect(summary.views[0]).toMatchObject({ state: 'frozen' });

    // Locate totals row and verify live SUM formula + currency format
    let totalsRowNum = 0;
    summary.eachRow((row, num) => {
      if (row.getCell(1).value === 'Fleet Total') totalsRowNum = num;
    });
    expect(totalsRowNum).toBeGreaterThan(10);
    const revTotalCell = summary.getRow(totalsRowNum).getCell(3);
    expect(revTotalCell.numFmt).toBe(EXCEL_CURRENCY_FMT);
    expect(revTotalCell.value).toMatchObject({
      formula: expect.stringMatching(/^SUM\(C\d+:C\d+\)$/),
      result: 6600,
    });
  });
});
