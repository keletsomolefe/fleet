import { describe, expect, it } from 'vitest';
import {
  parseActivityData,
  parseCreateRateInput,
  parseCustomerInput,
  parseCustomerProductInput,
  parseMonthString,
  parseTruckExpenseInput,
} from './transport.dto.js';

describe('Transport DTO validation', () => {
  it('validates customer input with industry and trims text', () => {
    const parsed = parseCustomerInput({
      name: '  Highveld Chrome  ',
      industry: 'Mining',
      contact: 'Thabo',
      phone: '+27 82 555 0101',
    });
    expect(parsed.name).toBe('Highveld Chrome');
    expect(parsed.industry).toBe('Mining');
    expect(parsed.active).toBe(true);
  });

  it('requires customer-product association to either supply or receive', () => {
    expect(() =>
      parseCustomerProductInput({
        customerId: '11111111-1111-4111-8111-111111111111',
        productId: '22222222-2222-4222-8222-222222222222',
        supplies: false,
        receives: false,
      }),
    ).toThrow(/supplies, receives, or both/);
  });

  it('enforces paired origin/destination and valid effective date window on rates', () => {
    expect(() =>
      parseCreateRateInput({
        customerProductId: '11111111-1111-4111-8111-111111111111',
        originId: '22222222-2222-4222-8222-222222222222',
        destinationId: null,
        method: 'quantity',
        basis: 'delivered',
        unit: 'tonne',
        price: '150.00',
        startsOn: '2026-11-01',
      }),
    ).toThrow(/both a collection site and delivery site/);

    expect(() =>
      parseCreateRateInput({
        customerProductId: '11111111-1111-4111-8111-111111111111',
        method: 'quantity',
        basis: 'delivered',
        unit: 'tonne',
        price: '150.00',
        startsOn: '2026-11-15',
        endsOn: '2026-11-01',
      }),
    ).toThrow(/End date cannot be earlier/);
  });

  it('parses road expense and delivery activities with waybill and dwell timestamps', () => {
    const expense = parseActivityData({
      kind: 'expense',
      occurredAt: '2026-11-25T10:15:00.000Z',
      expenseCategory: 'toll',
      expenseAmount: '385.50',
      vendorName: 'N4 Middelburg Plaza',
      receiptNumber: 'TL-88412',
      odometerKm: '284690.5',
      note: 'Loaded eastbound toll',
    });
    expect(expense.kind).toBe('expense');
    expect(expense.expenseCategory).toBe('toll');
    expect(expense.expenseAmount).toBe('385.50');

    const delivery = parseActivityData({
      kind: 'delivery',
      occurredAt: '2026-11-25T11:00:00.000Z',
      arrivedAt: '2026-11-25T10:20:00.000Z',
      departedAt: '2026-11-25T11:00:00.000Z',
      waybillNumber: 'WB-2026-991',
      quantity: '33.5',
      unit: 'tonne',
      outcome: 'completed',
    });
    expect(delivery.waybillNumber).toBe('WB-2026-991');
    expect(delivery.arrivedAt).toBe('2026-11-25T10:20:00.000Z');
  });

  it('parses office truck expenses and month strings strictly', () => {
    const parsed = parseTruckExpenseInput({
      truckId: '11111111-1111-4111-8111-111111111111',
      occurredOn: '2026-11-24',
      category: 'repair',
      vendor: 'Witbank Truck Workshop',
      invoiceNumber: 'INV-4421',
      amount: '4850.00',
      notes: 'Replaced air brake valve',
    });
    expect(parsed.category).toBe('repair');
    expect(parsed.amount).toBe('4850.00');
    expect(parseMonthString('2026-11')).toBe('2026-11');
    expect(() => parseMonthString('2026-13')).toThrow(/valid month/);
  });
});
