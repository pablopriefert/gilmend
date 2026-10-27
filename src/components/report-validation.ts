// Validation shared by the report form (browser) and POST /api/reports (server), so both
// say the same thing. Pure functions over plain values: no DOM, no node APIs.

export const MIN_PHOTOS = 1;
export const MAX_PHOTOS = 3;
export const MAX_PHOTO_BYTES = 8 * 1024 * 1024;
export const ACCEPTED_PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export const MAX_MESSAGE_CHARS = 4000;
export const MIN_MESSAGE_CHARS = 5;
export const MAX_ORDER_NUMBER_CHARS = 40;
export const MAX_EMAIL_CHARS = 254;

export interface ReportFields {
  orderNumber: string;
  email: string;
  message: string;
}

/** What validation needs to know about a photo: a browser `File` or a server `File` both fit. */
export interface PhotoLike {
  name: string;
  size: number;
  type: string;
}

export type FieldName = "orderNumber" | "email" | "message" | "photos";
export type FieldErrors = Partial<Record<FieldName, string>>;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const CONTROL_CHARS_RE = /[\u0000-\u001f\u007f]/;

export function validateFields(fields: ReportFields): FieldErrors {
  const errors: FieldErrors = {};

  const order = fields.orderNumber.trim();
  if (order === "") errors.orderNumber = "Enter the order number from the confirmation e-mail.";
  else if (order.length > MAX_ORDER_NUMBER_CHARS)
    errors.orderNumber = `The order number is too long (max ${MAX_ORDER_NUMBER_CHARS} characters).`;
  else if (CONTROL_CHARS_RE.test(order)) errors.orderNumber = "The order number contains invalid characters.";

  const email = fields.email.trim();
  if (email === "") errors.email = "Enter the e-mail address used for the order.";
  else if (email.length > MAX_EMAIL_CHARS || !EMAIL_RE.test(email))
    errors.email = "Enter a valid e-mail address.";

  const message = fields.message.trim();
  if (message.length < MIN_MESSAGE_CHARS) errors.message = "Describe what happened in a few words.";
  else if (message.length > MAX_MESSAGE_CHARS)
    errors.message = `The message is too long (max ${MAX_MESSAGE_CHARS} characters).`;

  return errors;
}

export function validatePhotos(photos: PhotoLike[]): string | null {
  if (photos.length < MIN_PHOTOS) return "Attach at least one photo of the damage.";
  if (photos.length > MAX_PHOTOS) return `You can attach up to ${MAX_PHOTOS} photos.`;
  for (const photo of photos) {
    if (!(ACCEPTED_PHOTO_TYPES as readonly string[]).includes(photo.type))
      return `"${photo.name}" is not a JPEG, PNG or WebP image.`;
    if (photo.size === 0) return `"${photo.name}" is empty.`;
    if (photo.size > MAX_PHOTO_BYTES)
      return `"${photo.name}" is larger than ${MAX_PHOTO_BYTES / (1024 * 1024)} MB.`;
  }
  return null;
}

export function validateReport(fields: ReportFields, photos: PhotoLike[]): FieldErrors {
  const errors = validateFields(fields);
  const photoError = validatePhotos(photos);
  if (photoError) errors.photos = photoError;
  return errors;
}

export type ImageKind = "jpeg" | "png" | "webp";

/**
 * Identify an image from its first bytes. The MIME type sent by a client is only a claim, so
 * the server checks the real signature before writing anything to disk.
 */
export function sniffImageKind(bytes: Uint8Array): ImageKind | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  )
    return "png";
  // WebP: "RIFF" <size> "WEBP"
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  )
    return "webp";
  return null;
}

export const IMAGE_EXTENSION: Record<ImageKind, string> = { jpeg: "jpg", png: "png", webp: "webp" };
