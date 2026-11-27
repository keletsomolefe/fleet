import type { FastifyReply, FastifyRequest } from 'fastify';
import {
  BadRequestError,
  HttpError,
  PayloadTooLargeError,
} from './errors.js';
import type { UploadedPhoto } from './storage/photo.js';

export const privateResponse = async (
  _request: FastifyRequest,
  reply: FastifyReply,
) => {
  reply.header('Cache-Control', 'private, no-store');
};

export function header(
  request: Pick<FastifyRequest, 'headers'>,
  name: string,
): string | undefined {
  const value = request.headers[name];
  return typeof value === 'string' ? value : undefined;
}

export function sendPrivatePhoto(
  reply: FastifyReply,
  photo: { type: string; buffer: Buffer },
) {
  return reply
    .headers({
      'Content-Type': photo.type,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'Referrer-Policy': 'no-referrer',
    })
    .send(photo.buffer);
}

export interface PhotoUploadLimits {
  maxFields: number;
  maxParts: number;
  invalidMessage: string;
}

/**
 * Shared Fastify multipart photo upload reader (used by both repairs and
 * service-job completion endpoints). Enforces strict file size, count, and
 * field limits and rejects duplicate or unexpected field names.
 */
export async function readPhotoUpload(
  request: FastifyRequest,
  limits: PhotoUploadLimits,
): Promise<{ body: unknown; files: UploadedPhoto[] }> {
  const files: UploadedPhoto[] = [];
  if (!request.isMultipart()) return { body: request.body, files };

  const body: Record<string, unknown> = Object.create(null);
  const errors = request.server.multipartErrors;
  try {
    for await (const part of request.parts({
      limits: {
        fileSize: 5 * 1024 * 1024,
        files: 3,
        fields: limits.maxFields,
        fieldSize: 5000,
        parts: limits.maxParts,
      },
    })) {
      if (part.type === 'file') {
        const buffer = await part.toBuffer();
        if (part.fieldname !== 'photos') {
          throw new BadRequestError('Unexpected field');
        }
        files.push({ buffer, mimetype: part.mimetype, size: buffer.length });
      } else {
        if (part.fieldnameTruncated || part.valueTruncated) {
          throw new BadRequestError('Field value too long');
        }
        if (Object.hasOwn(body, part.fieldname)) {
          throw new BadRequestError('Unexpected field');
        }
        body[part.fieldname] = part.value;
      }
    }
  } catch (error) {
    if (error instanceof HttpError) throw error;
    if (error instanceof errors.RequestFileTooLargeError) {
      throw new PayloadTooLargeError('File too large');
    }
    if (error instanceof errors.FilesLimitError) {
      throw new BadRequestError('Too many files');
    }
    if (error instanceof errors.FieldsLimitError) {
      throw new BadRequestError('Too many fields');
    }
    if (error instanceof errors.PartsLimitError) {
      throw new BadRequestError('Too many parts');
    }
    throw new BadRequestError(limits.invalidMessage);
  }
  return { body, files };
}
