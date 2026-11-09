import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { uuidPattern } from '../fleet/fleet.input.js';

type Claim = {
  issueId: string;
  purpose: 'view' | 'repair';
  expires: number;
  phone?: string;
};

@Injectable()
export class RepairAccess {
  private secret() {
    const key = process.env.REPAIR_LINK_SECRET;
    if (!key || key.length < 32)
      throw new ServiceUnavailableException(
        'Repair access is unavailable. Please contact the office.',
      );
    return key;
  }
  sign(claim: Claim): string {
    const body = Buffer.from(JSON.stringify(claim)).toString('base64url');
    return `${body}.${createHmac('sha256', this.secret()).update(body).digest('base64url')}`;
  }
  verify(token: string, issueId: string, purpose?: Claim['purpose']): Claim {
    const denied = () =>
      new UnauthorizedException(
        'This link or code has expired. Please open the link from WhatsApp again.',
      );
    if (!uuidPattern.test(issueId) || token.length > 1024) throw denied();
    const [body, signature, extra] = token.split('.');
    if (!body || !signature || extra || !/^[\w-]+$/.test(signature))
      throw denied();
    const expected = createHmac('sha256', this.secret()).update(body).digest();
    const supplied = Buffer.from(signature, 'base64url');
    if (
      expected.length !== supplied.length ||
      !timingSafeEqual(expected, supplied)
    )
      throw denied();
    let claim: Claim;
    try {
      claim = JSON.parse(Buffer.from(body, 'base64url').toString());
    } catch {
      throw denied();
    }
    if (
      !claim ||
      claim.issueId !== issueId ||
      !['view', 'repair'].includes(claim.purpose) ||
      (purpose && claim.purpose !== purpose) ||
      !Number.isSafeInteger(claim.expires) ||
      claim.expires <= Date.now() ||
      (claim.purpose === 'repair' && !/^\d{8,15}$/.test(claim.phone ?? ''))
    )
      throw denied();
    return claim;
  }
  link(issueId: string, now = Date.now()) {
    const base = new URL(process.env.APP_URL ?? 'http://127.0.0.1:3042');
    if (process.env.NODE_ENV === 'production' && base.protocol !== 'https:')
      throw new ServiceUnavailableException(
        'Secure repair links are not configured.',
      );
    const url = new URL(`/repairs/${issueId}`, base);
    url.hash = new URLSearchParams({
      token: this.sign({
        issueId,
        purpose: 'view',
        expires: now + 7 * 86400000,
      }),
    }).toString();
    return url.toString();
  }
}
