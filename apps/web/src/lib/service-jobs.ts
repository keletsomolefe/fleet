export type ServiceType =
  | 'mechanical'
  | 'tyres'
  | 'towing'
  | 'electrical'
  | 'bodywork'
  | 'fuel'
  | 'accident'
  | 'other';
export type JobStatus =
  | 'open'
  | 'assigned'
  | 'in_progress'
  | 'completed'
  | 'closed'
  | 'cancelled';
export type ProgressStage = 'en_route' | 'arrived' | 'working';
export type OfferStatus =
  | 'queued'
  | 'sending'
  | 'sent'
  | 'delivered'
  | 'read'
  | 'accepted'
  | 'declined'
  | 'failed'
  | 'expired';

export const serviceTypeLabels: Record<ServiceType, string> = {
  mechanical: 'Mechanical',
  tyres: 'Tyres',
  towing: 'Towing',
  electrical: 'Electrical',
  bodywork: 'Body damage',
  fuel: 'Fuel',
  accident: 'Accident',
  other: 'Other',
};
export const serviceTypeDescriptions: Record<ServiceType, string> = {
  mechanical: 'Engine, brakes, gearbox or another mechanical fault',
  tyres: 'Puncture, tyre damage or wheel problem',
  towing: 'Recovery or towing',
  electrical: 'Battery, wiring, lights or electrical fault',
  bodywork: 'Accident damage or body repair',
  fuel: 'Fuel delivery or fuel problem',
  accident: 'Accident or safety concern',
  other: 'Another service request',
};
export const providerServiceOptions = Object.keys(
  serviceTypeLabels,
) as ServiceType[];

export type ServiceProvider = {
  id: string;
  companyName: string;
  contactName: string;
  whatsappNumber: string;
  phone: string | null;
  email: string | null;
  services: ServiceType[];
  coverageArea: string | null;
  notes: string | null;
  status: 'active' | 'paused';
  alertsEnabled: boolean;
  receivesAlerts: boolean;
  optedInAt: string | null;
  optedOutAt: string | null;
  optOutReason: string | null;
  createdAt: string;
  updatedAt: string;
  jobsHandled?: number;
  lastJobAt?: string | null;
};
export type JobSummary = {
  id: string;
  reference: string;
  status: JobStatus;
  serviceType: ServiceType;
  title: string;
  provider: { id: string; companyName: string } | null;
  latestStage: ProgressStage | null;
  createdAt: string;
  acceptedAt: string | null;
  completedAt: string | null;
  closedAt: string | null;
  cancelledAt: string | null;
  isActive: boolean;
};
export type JobListRow = JobSummary & {
  truck: {
    id: string;
    registration: string;
    identifier: string;
    make: string;
    model: string;
  } | null;
  driver: { id: string; name: string } | null;
  description: string;
  urgency: 'urgent' | 'normal';
  locationText: string | null;
  latitude?: number | null;
  longitude?: number | null;
  updatedAt: string;
};
export type JobOffer = {
  id: string;
  provider: {
    id: string;
    companyName: string;
    contactName: string;
    whatsappNumber: string;
  };
  status: OfferStatus;
  attempts: number;
  linkVersion: number;
  sentAt: string | null;
  deliveredAt: string | null;
  readAt: string | null;
  respondedAt: string | null;
  responderName: string | null;
  responseChannel: 'web' | 'whatsapp' | 'admin' | null;
  lastErrorCode: string | null;
  lastErrorTitle: string | null;
  createdAt: string;
};
export type JobEvent = {
  id: string;
  kind: string;
  actorType: 'driver' | 'admin' | 'provider' | 'system';
  actorName: string | null;
  channel: 'app' | 'dashboard' | 'web' | 'whatsapp' | 'system' | null;
  fromStatus: JobStatus | null;
  toStatus: JobStatus | null;
  note: string | null;
  createdAt: string;
};
export type JobDetail = {
  job: JobListRow & {
    issueId: string | null;
    issue: {
      id: string;
      category: 'vehicle' | 'safety' | 'other';
      description: string;
      createdAt: string;
      resolvedAt: string | null;
      resolutionNote: string | null;
    } | null;
    source: 'driver' | 'admin';
    broadcastAt: string | null;
    startedAt: string | null;
    completionNote: string | null;
    completionCostCents: number | null;
    currency: string;
    closeNote: string | null;
    resolvedIssueOnClose: boolean;
    cancelReason: string | null;
    closedBy: string | null;
    cancelledBy: string | null;
  };
  offers: JobOffer[];
  events: JobEvent[];
  attachments: Array<{
    id: string;
    mimeType: string;
    byteSize: number;
    createdAt: string;
  }>;
  activeProviderCount: number;
  alertsReady: boolean;
};
export type JobCounts = {
  waiting: number;
  working: number;
  awaitingClose: number;
  closedToday: number;
  alertsReady: boolean;
};
export type JobList = {
  items: JobListRow[];
  total: number;
  page: number;
  pageSize: number;
  counts: JobCounts;
  alertsReady: boolean;
};
export type ProviderList = {
  alertsReady: boolean;
  items: ServiceProvider[];
  total: number;
  page: number;
  pageSize: number;
};
export type PublicJob = {
  latestStage?: ProgressStage | null;
  state:
    | 'open'
    | 'assigned'
    | 'in_progress'
    | 'completed'
    | 'closed'
    | 'cancelled'
    | 'declined'
    | 'expired'
    | 'assigned_elsewhere';
  reference: string;
  status?: JobStatus;
  serviceType?: ServiceType;
  title?: string;
  urgency?: 'urgent' | 'normal';
  description?: string;
  locationText?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  createdAt?: string;
  acceptedAt?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  completionNote?: string | null;
  completionCostCents?: number | null;
  currency?: string;
  provider?: { companyName: string; contactName?: string };
  truck?: {
    registration: string;
    identifier: string;
    make: string;
    model: string;
  };
  canAccept?: boolean;
  canProgress?: boolean;
  canComplete?: boolean;
  photos?: string[];
  officePhone?: string | null;
};

export type JobSearch = {
  q: string;
  page: number;
  status: string;
  providerId: string;
};
export const jobSearchDefaults: JobSearch = {
  q: '',
  page: 1,
  status: 'active',
  providerId: '',
};
export function validateJobSearch(s: Record<string, unknown>): JobSearch {
  return {
    q: typeof s.q === 'string' ? s.q.slice(0, 200) : '',
    page:
      Number.isInteger(Number(s.page)) &&
      Number(s.page) > 0 &&
      Number(s.page) <= 999999
        ? Number(s.page)
        : 1,
    status: ['active', 'waiting', 'working', 'awaiting', 'closed', 'completed', 'all'].includes(
      String(s.status),
    )
      ? String(s.status)
      : 'active',
    providerId: typeof s.providerId === 'string' ? s.providerId : '',
  };
}
export type ProviderSearch = {
  q: string;
  page: number;
  status: string;
};
export const providerSearchDefaults: ProviderSearch = {
  q: '',
  page: 1,
  status: '',
};
export function validateProviderSearch(s: Record<string, unknown>): ProviderSearch {
  return {
    q: typeof s.q === 'string' ? s.q.slice(0, 200) : '',
    page:
      Number.isInteger(Number(s.page)) &&
      Number(s.page) > 0 &&
      Number(s.page) <= 999999
        ? Number(s.page)
        : 1,
    status: ['active', 'paused', 'receives_alerts', 'alerts_off'].includes(String(s.status))
      ? String(s.status)
      : '',
  };
}

async function request<T>(
  path: string,
  options: RequestInit = {},
  csrf?: string,
): Promise<T> {
  const response = await fetch(`/api/admin/${path}`, {
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(csrf ? { 'X-CSRF-Token': csrf } : {}),
      ...options.headers,
    },
    cache: 'no-store',
  });
  const body = await response.json().catch(() => null);
  if (!response.ok)
    throw new Error(
      typeof body?.message === 'string'
        ? body.message
        : response.status === 403
          ? 'You do not have access to this action.'
          : 'Could not complete this request. Please try again.',
    );
  return body as T;
}
function query(search: Record<string, string | number>) {
  return new URLSearchParams(
    Object.entries(search)
      .filter(([, value]) => value !== '' && value !== undefined)
      .map(([key, value]) => [key, String(value)]),
  ).toString();
}
export const getJobs = (search: JobSearch) =>
  request<JobList>(`service-jobs?${query(search)}`);
export const getJobCounts = () => request<JobCounts>('service-jobs/summary');
export const getJob = (id: string) => request<JobDetail>(`service-jobs/${id}`);
export const createJob = (
  csrf: string,
  body: Record<string, unknown>,
) =>
  request<JobSummary>('service-jobs', {
    method: 'POST',
    body: JSON.stringify(body),
  }, csrf);
export const jobAction = (
  csrf: string,
  id: string,
  action: string,
  body: Record<string, unknown> = {},
) =>
  request<Record<string, unknown>>(`service-jobs/${id}/${action}`, {
    method: 'POST',
    body: JSON.stringify(body),
  }, csrf);
export const offerAction = (
  csrf: string,
  jobId: string,
  offerId: string,
  action: 'resend' | 'revoke' | 'link',
  method: 'POST' | 'GET' = 'POST',
) =>
  request<{ link?: string; queued?: number }>(
    `service-jobs/${jobId}/offers/${offerId}/${action}`,
    { method },
    csrf,
  );
export const getProviders = (search: ProviderSearch) =>
  request<ProviderList>(`service-providers?${query(search)}`);
export const getProvider = (id: string) =>
  request<{ provider: ServiceProvider; jobs: JobListRow[] }>(
    `service-providers/${id}`,
  );
export const createProvider = (
  csrf: string,
  body: Record<string, unknown>,
) =>
  request<ServiceProvider>('service-providers', {
    method: 'POST',
    body: JSON.stringify(body),
  }, csrf);
export const updateProvider = (
  csrf: string,
  id: string,
  body: Record<string, unknown>,
) =>
  request<ServiceProvider>(`service-providers/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  }, csrf);

export function jobStatusLabel(
  status: JobStatus,
  latestStage?: ProgressStage | null,
) {
  if (status === 'open') return 'Waiting for provider';
  if (status === 'completed') return 'Awaiting office check';
  if (status === 'closed') return 'Closed';
  if (status === 'cancelled') return 'Cancelled';
  if (status === 'assigned') return 'Provider assigned';
  if (latestStage === 'en_route') return 'On the way';
  if (latestStage === 'arrived') return 'On site';
  if (latestStage === 'working') return 'Working';
  return 'In progress';
}
export function offerStatusLabel(status: OfferStatus) {
  const labels: Record<OfferStatus, string> = {
    queued: 'Queued',
    sending: 'Sending',
    sent: 'Sent',
    delivered: 'Delivered',
    read: 'Read',
    accepted: 'Accepted',
    declined: 'Declined',
    failed: 'Failed',
    expired: 'Expired',
  };
  return labels[status];
}
export function money(cents: number | null | undefined, currency = 'ZAR') {
  if (cents == null) return null;
  return new Intl.NumberFormat('en-ZA', {
    style: 'currency',
    currency,
  }).format(cents / 100);
}
export function elapsed(from: string, to = Date.now()) {
  const minutes = Math.max(0, Math.floor((to - Date.parse(from)) / 60000));
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'}`;
}
async function publicRequest<T>(
  path: string,
  code: string,
  options: RequestInit = {},
) {
  const response = await fetch(`/api/public/service-job${path}`, {
    ...options,
    headers: {
      ...(options.body && !(options.body instanceof FormData)
        ? { 'Content-Type': 'application/json' }
        : {}),
      Authorization: `Bearer ${code}`,
      ...options.headers,
    },
    cache: 'no-store',
  });
  const body = await response.json().catch(() => null);
  if (!response.ok)
    throw new Error(
      typeof body?.message === 'string'
        ? body.message
        : 'Could not load this job. Ask VHH Fleet to send a new link.',
    );
  return body as T;
}
export const getPublicJob = (code: string) => publicRequest<PublicJob>('', code);
export const publicJobAction = (
  code: string,
  action: 'accept' | 'decline' | 'progress',
  body: Record<string, unknown>,
) =>
  publicRequest<Record<string, unknown>>(`/${action}`, code, {
    method: 'POST',
    body: JSON.stringify(body),
  });
export const completePublicJob = (code: string, form: FormData) =>
  publicRequest<{ reference: string; status: string }>('/complete', code, {
    method: 'POST',
    body: form,
  });
export async function getPublicPhoto(code: string, photoId: string) {
  const response = await fetch(`/api/public/service-job/photos/${photoId}`, {
    headers: { Authorization: `Bearer ${code}` },
    cache: 'no-store',
  });
  if (!response.ok) throw new Error('Could not load this photo.');
  return response.blob();
}
