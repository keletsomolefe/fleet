import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  ServiceUnavailableError,
  UnauthorizedError,
} from '../../../shared/errors.js';
import { isUuid } from '../../../shared/identifiers.js';

const signatureLength = 43;

function linkSecret(): string {
  const value = process.env.SERVICE_JOB_LINK_SECRET;
  if (!value || value.length < 32) {
    throw new ServiceUnavailableError(
      'Provider links are not available. Please contact the office.',
    );
  }
  return value;
}

function signOffer(offerId: string, linkVersion: number): string {
  return createHmac('sha256', linkSecret())
    .update(`${offerId}:${linkVersion}`)
    .digest('base64url');
}

function parseOfferCode(code: string): string {
  const denied = () =>
    new UnauthorizedError(
      'This link has expired. Ask VHH Fleet to send a new one.',
    );
  if (!code || code.length > 200) throw denied();
  const separator = code.lastIndexOf('.');
  if (separator <= 0) throw denied();
  const offerId = code.slice(0, separator);
  const supplied = code.slice(separator + 1);
  if (!isUuid(offerId) || supplied.length !== signatureLength) throw denied();
  return offerId;
}

/** Domain service functions for signing and verifying versioned HMAC provider links. */
export const serviceJobAccess = {
  link(offerId: string, linkVersion: number): string {
    const base = new URL(process.env.APP_URL ?? 'http://127.0.0.1:3042');
    if (process.env.NODE_ENV === 'production' && base.protocol !== 'https:') {
      throw new ServiceUnavailableError(
        'Secure provider links are not configured.',
      );
    }
    return new URL(`/j/${offerId}.${signOffer(offerId, linkVersion)}`, base)
      .href;
  },

  offerIdFromCode(code: string): string {
    return parseOfferCode(code);
  },

  verifySignature(code: string, linkVersion: number): string {
    const offerId = parseOfferCode(code);
    const supplied = Buffer.from(code.slice(code.lastIndexOf('.') + 1));
    const expected = Buffer.from(signOffer(offerId, linkVersion));
    if (
      supplied.length !== expected.length ||
      !timingSafeEqual(supplied, expected)
    ) {
      throw new UnauthorizedError(
        'This link has expired. Ask VHH Fleet to send a new one.',
      );
    }
    return offerId;
  },
};

export type ServiceJobAccess = typeof serviceJobAccess;
