import { BadRequestError } from '../http/errors.js';

export type UploadedPhoto = { buffer: Buffer; mimetype: string; size: number };

export function photoType(file: UploadedPhoto) {
  const b = file.buffer;
  if (!b?.length || b.length > 5 * 1024 * 1024)
    throw new BadRequestError('Each photo must be 5 MB or smaller.');
  if (
    file.mimetype === 'image/jpeg' &&
    b[0] === 0xff &&
    b[1] === 0xd8 &&
    b[b.length - 2] === 0xff &&
    b[b.length - 1] === 0xd9
  )
    return 'image/jpeg';
  if (
    file.mimetype === 'image/png' &&
    b.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))
  )
    return 'image/png';
  if (
    file.mimetype === 'image/webp' &&
    b.toString('ascii', 0, 4) === 'RIFF' &&
    b.toString('ascii', 8, 12) === 'WEBP'
  )
    return 'image/webp';
  throw new BadRequestError('Choose JPG, PNG or WebP photos.');
}
