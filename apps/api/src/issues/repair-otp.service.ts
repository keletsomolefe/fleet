import {
  createHash,
  randomInt,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto';
import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  Inject,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { OpenWaService } from './openwa.service.js';
import { RepairAccess } from './repair-access.js';

type Challenge = {
  issueId: string;
  phone: string;
  digest: Buffer;
  expires: number;
  attempts: number;
};
const digest = (id: string, code: string) =>
  createHash('sha256').update(`${id}:${code}`).digest();
@Injectable()
export class RepairOtpService {
  private challenges = new Map<string, Challenge>();
  private requests = new Map<string, number[]>();
  constructor(
    @Inject(OpenWaService) private readonly wa: OpenWaService,
    @Inject(RepairAccess) private readonly access: RepairAccess,
  ) {}
  async requireMember(phone: string) {
    let member: boolean;
    try {
      member = await this.wa.isMember(phone);
    } catch {
      throw new ServiceUnavailableException(
        'WhatsApp is unavailable. Please try again shortly.',
      );
    }
    if (!member)
      throw new ForbiddenException(
        'Use a WhatsApp number in the mechanics group.',
      );
  }
  async request(issueId: string, raw: unknown) {
    const input = raw as { phone?: unknown };
    if (
      !input ||
      typeof input.phone !== 'string' ||
      !/^\+[1-9]\d{7,14}$/.test(input.phone)
    )
      throw new BadRequestException(
        'Enter your WhatsApp number with country code, for example +27821234567.',
      );
    const phone = input.phone.slice(1),
      now = Date.now();
    for (const [id, c] of this.challenges)
      if (c.expires <= now) this.challenges.delete(id);
    for (const [key, times] of this.requests) {
      const recent = times.filter((t) => t > now - 3600000);
      if (recent.length) this.requests.set(key, recent);
      else this.requests.delete(key);
    }
    const times = this.requests.get(phone) ?? [],
      all = this.requests.get('*') ?? [];
    if (
      (times.at(-1) ?? 0) > now - 60000 ||
      times.length >= 5 ||
      all.length >= 30
    )
      throw new HttpException(
        'Please wait before requesting another code.',
        429,
      );
    // Reserve the quota before any awaits so concurrent requests cannot bypass it.
    this.requests.set(phone, [...times, now]);
    this.requests.set('*', [...all, now]);
    await this.requireMember(phone);
    for (const [id, c] of this.challenges)
      if (c.phone === phone && c.issueId === issueId)
        this.challenges.delete(id);
    const id = randomUUID(),
      code = randomInt(0, 1000000).toString().padStart(6, '0');
    this.challenges.set(id, {
      issueId,
      phone,
      digest: digest(id, code),
      expires: now + 300000,
      attempts: 0,
    });
    try {
      await this.wa.send(
        `${phone}@c.us`,
        `VHH Fleet repair code: ${code}\nValid for 5 minutes. Enter it on the repair page. Do not share this code.`,
        `fleet-otp-${id}`,
      );
    } catch {
      this.challenges.delete(id);
      throw new ServiceUnavailableException(
        'Could not send the code. Please try again shortly.',
      );
    }
    return { challengeId: id };
  }
  verify(issueId: string, raw: unknown) {
    const v = raw as { challengeId?: string; code?: string };
    const id = typeof v?.challengeId === 'string' ? v.challengeId : '';
    const c = this.challenges.get(id);
    if (
      !c ||
      c.issueId !== issueId ||
      c.expires <= Date.now() ||
      c.attempts >= 5
    )
      throw new UnauthorizedException('Request a new code and try again.');
    c.attempts++;
    const valid =
      typeof v.code === 'string' &&
      /^\d{6}$/.test(v.code) &&
      timingSafeEqual(c.digest, digest(id, v.code));
    if (!valid) {
      if (c.attempts >= 5) this.challenges.delete(id);
      throw new UnauthorizedException('That code is incorrect. Try again.');
    }
    this.challenges.delete(id);
    return {
      token: this.access.sign({
        issueId,
        purpose: 'repair',
        phone: c.phone,
        expires: Date.now() + 30 * 60000,
      }),
    };
  }
}
