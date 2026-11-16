import { createHmac, timingSafeEqual } from 'node:crypto';
import { ServiceUnavailableError, UnauthorizedError } from '../http/errors.js';
import { uuidPattern } from '../fleet/fleet.input.js';

const signatureLength = 43;

export class ServiceJobAccess {
  private secret(): string {
    const value = process.env.SERVICE_JOB_LINK_SECRET;
    if (!value || value.length < 32)
      throw new ServiceUnavailableError(
        'Provider links are not available. Please contact the office.',
      );
    return value;
  }

  private sign(offerId: string, linkVersion: number): string {
    return createHmac('sha256', this.secret())
      .update(`${offerId}:${linkVersion}`)
      .digest('base64url');
  }

  link(offerId: string, linkVersion: number): string {
    const base = new URL(process.env.APP_URL ?? 'http://127.0.0.1:3042');
    if (process.env.NODE_ENV === 'production' && base.protocol !== 'https:')
      throw new ServiceUnavailableError(
        'Secure provider links are not configured.',
      );
    return new URL(`/j/${offerId}.${this.sign(offerId, linkVersion)}`, base)
      .href;
  }

  private parseCode(code: string): string {
    const denied = () =>
      new UnauthorizedError(
        'This link has expired. Ask VHH Fleet to send a new one.',
      );
    if (!code || code.length > 200) throw denied();
    const separator = code.lastIndexOf('.');
    if (separator <= 0) throw denied();
    const offerId = code.slice(0, separator),
      supplied = code.slice(separator + 1);
    if (!uuidPattern.test(offerId) || supplied.length !== signatureLength)
      throw denied();
    return offerId;
  }

  offerIdFromCode(code: string): string {
    return this.parseCode(code);
  }

  verifySignature(code: string, linkVersion: number): string {
    const offerId = this.parseCode(code);
    const supplied = Buffer.from(code.slice(code.lastIndexOf('.') + 1));
    const expected = Buffer.from(this.sign(offerId, linkVersion));
    if (
      supplied.length !== expected.length ||
      !timingSafeEqual(supplied, expected)
    )
      throw new UnauthorizedError(
        'This link has expired. Ask VHH Fleet to send a new one.',
      );
    return offerId;
  }
}
