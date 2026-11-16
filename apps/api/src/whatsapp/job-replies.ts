import type { ProgressStage } from '../service-jobs/service-job.entity.js';

export const jobReplies = {
  unavailable: 'This job is no longer available to you. Contact VHH Fleet if you need help.',
  covered: 'This job has already been assigned to another provider.',
  declined: "Thanks, we'll ask another provider for this job.",
  openLatest: 'Open the latest VHH Fleet alert to view the job.',
  accepted: (reference: string) => `You have job ${reference}. Open it to see the details and update progress.`,
  progress: (stage: ProgressStage) => `Updated: ${{ en_route: 'On the way', arrived: 'Arrived', working: 'Working' }[stage]}.`,
  completePrompt: (reference: string) =>
    `To complete ${reference}, reply with a note about the work. To include photos, send up to 3 before your note. To add a charge, send AMOUNT 1500.00 before your note.`,
  completeFallback: 'Open the job to record what was done and mark it completed.',
  alreadyCompleted: (reference: string) => `Job ${reference} is already complete.`,
  completed: (reference: string) => `Job ${reference} is complete. VHH Fleet has been notified.`,
};
