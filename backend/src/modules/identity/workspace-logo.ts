import PDFDocument from 'pdfkit';
import { pngPixelDataOk } from '../../shared/images/png';

/** The workspace logo (CD-378): a PNG or JPEG of at most 1 MB, printed on the external minutes PDF. */
export const MAX_LOGO_BYTES = 1024 * 1024;

export type LogoContentType = 'image/png' | 'image/jpeg';

/** An uploaded file, as multer hands it over (memory storage). */
export interface UploadedLogo {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

/** Why a logo can't be used, as the app shows it; null when it can. */
export function logoProblem(file: UploadedLogo | undefined): string | null {
  if (!file || !file.size) return 'Choose a PNG or JPG image';
  if (file.size > MAX_LOGO_BYTES) return 'The logo can be at most 1 MB. Choose a smaller image.';
  if (!logoContentType(file.buffer)) return 'The logo must be a PNG or JPG image.';
  if (!printable(file.buffer)) return "This image can't be read. Save it again as PNG or JPG and upload that.";
  return null;
}

/** PNG or JPEG by the file's first bytes (what it claims to be doesn't count). */
export function logoContentType(buffer: Buffer): LogoContentType | null {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  return null;
}

/**
 * pdfkit can place it (the minutes PDF would fail on an image it can't decode). A PNG's pixel data
 * is checked first: pdfkit decodes some PNGs asynchronously, where a broken one ends the process
 * instead of throwing here.
 */
function printable(buffer: Buffer): boolean {
  if (logoContentType(buffer) === 'image/png' && !pngPixelDataOk(buffer)) return false;
  try {
    new PDFDocument({ size: 'A4' }).image(buffer, 0, 0, { fit: [120, 40] });
    return true;
  } catch {
    return false;
  }
}
