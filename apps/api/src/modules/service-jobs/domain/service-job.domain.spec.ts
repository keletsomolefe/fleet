import { ConflictError } from '../../../shared/errors.js';
import {
  cancelServiceJob,
  closeServiceJob,
  completeServiceJob,
  markServiceJobInProgress,
  reopenServiceJob,
  type ServiceJob,
} from './service-job.entity.js';
import {
  recordOfferDeliveryStatus,
  requeueOffer,
  type ServiceJobOffer,
} from './service-job-offer.entity.js';
import {
  canProviderReceiveAlerts,
  optOutServiceProvider,
  updateProviderStatus,
  type ServiceProvider,
} from './service-provider.entity.js';
import type { User } from '../../identity/domain/user.entity.js';

describe('Service job domain invariants', () => {
  const actor = { id: 'admin-1' } as User;

  function makeJob(overrides: Partial<ServiceJob> = {}): ServiceJob {
    return {
      id: 'job-1',
      reference: 'SJ-000001',
      status: 'assigned',
      provider: { id: 'prov-1' } as ServiceProvider,
      resolvedIssueOnClose: false,
      startedAt: null,
      completedAt: null,
      closedAt: null,
      closedBy: null,
      closeNote: null,
      cancelledAt: null,
      cancelledBy: null,
      cancelReason: null,
      completionNote: null,
      completionCostCents: null,
      currency: 'ZAR',
      ...overrides,
    } as ServiceJob;
  }

  it('transitions assigned -> in_progress -> completed -> closed -> reopened cleanly', () => {
    const job = makeJob();
    expect(markServiceJobInProgress(job)).toBe('assigned');
    expect(job.status).toBe('in_progress');
    expect(job.startedAt).toBeInstanceOf(Date);

    expect(completeServiceJob(job, 'Replaced alternator', 250000, 'ZAR')).toBe(
      'in_progress',
    );
    expect(job.status).toBe('completed');
    expect(job.completionCostCents).toBe(250000);

    expect(closeServiceJob(job, actor, 'Verified invoice')).toBe('completed');
    expect(job.status).toBe('closed');

    const reopened = reopenServiceJob(job);
    expect(reopened.nextStatus).toBe('in_progress');
    expect(job.closedAt).toBeNull();
  });

  it('rejects invalid state transitions', () => {
    const cancelled = makeJob({ status: 'cancelled' });
    expect(() => closeServiceJob(cancelled, actor, 'note')).toThrow(
      ConflictError,
    );
    expect(() => cancelServiceJob(cancelled, actor, 'dup')).toThrow(
      ConflictError,
    );
    expect(() => reopenServiceJob(makeJob({ status: 'open' }))).toThrow(
      ConflictError,
    );
  });

  it('advances offer delivery status monotonically and resets cleanly on requeue', () => {
    const offer = {
      status: 'sent',
      linkVersion: 1,
      attempts: 2,
      sentAt: new Date(),
      deliveredAt: null,
      readAt: null,
      lastErrorCode: '500',
      lastErrorTitle: 'err',
    } as unknown as ServiceJobOffer;

    recordOfferDeliveryStatus(offer, 'delivered');
    expect(offer.status).toBe('delivered');
    expect(offer.deliveredAt).toBeInstanceOf(Date);

    recordOfferDeliveryStatus(offer, 'sent');
    expect(offer.status).toBe('delivered');

    requeueOffer(offer);
    expect(offer.status).toBe('queued');
    expect(offer.linkVersion).toBe(2);
    expect(offer.attempts).toBe(0);
    expect(offer.lastErrorCode).toBeNull();
  });

  it('enforces provider opt-in consent and opt-out rules', () => {
    const provider = {
      status: 'paused',
      alertsEnabled: true,
      optedInAt: null,
      optedOutAt: null,
      optOutReason: null,
      whatsappNumber: '27821234567',
    } as unknown as ServiceProvider;

    expect(canProviderReceiveAlerts(provider)).toBe(false);
    expect(() => updateProviderStatus(provider, 'active')).toThrow();

    provider.optedInAt = new Date();
    updateProviderStatus(provider, 'active');
    expect(canProviderReceiveAlerts(provider)).toBe(true);

    expect(optOutServiceProvider(provider, 'WhatsApp STOP')).toBe(true);
    expect(canProviderReceiveAlerts(provider)).toBe(false);
    expect(optOutServiceProvider(provider, 'WhatsApp STOP')).toBe(false);
  });
});
