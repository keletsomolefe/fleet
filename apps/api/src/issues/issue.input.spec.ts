import { BadRequestException } from '@nestjs/common';
import { parseIssue, parseIssueResolution } from './issue.input.js';

const valid = {
  id: '12345678-1234-1234-1234-123456789abc',
  truckId: null,
  category: 'vehicle',
  description: ' Tyre damaged ',
};
describe('Driver issue input', () => {
  it('accepts a report without a vehicle and trims the description', () => {
    expect(parseIssue(valid)).toEqual({
      ...valid,
      description: 'Tyre damaged',
    });
  });
  it.each([
    { id: 'bad' },
    { truckId: undefined },
    { truckId: 'bad' },
    { category: 'unknown' },
    { category: ['vehicle'] },
    { description: '' },
    { description: '   ' },
    { description: 'x'.repeat(2001) },
    { driverId: valid.id },
    { resolvedAt: new Date().toISOString() },
  ])('rejects invalid or server-owned fields %j', (patch) => {
    expect(() => parseIssue({ ...valid, ...patch })).toThrow(
      BadRequestException,
    );
  });
  it('requires a bounded resolution note and rejects injected fields', () => {
    expect(parseIssueResolution({ note: ' Repaired ' })).toBe('Repaired');
    for (const raw of [
      null,
      [],
      { note: ' ' },
      { note: 'x'.repeat(1001) },
      { note: 'OK', resolvedById: valid.id },
    ])
      expect(() => parseIssueResolution(raw)).toThrow(BadRequestException);
  });
});
