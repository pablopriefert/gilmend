// Best-effort downscaling of big photos in the browser before upload. Phone photos are often
// 5-10 MB; the server accepts up to 8 MB each, but a hosted deployment may cap the request
// body far lower (4.5 MB on Vercel), and the model does not need more than ~1600 px anyway.
// Any failure (no canvas, odd format) returns the original file untouched.

const SHRINK_ABOVE_BYTES = 1.4 * 1024 * 1024;
const MAX_SIDE = 1600;

export async function prepareImage(file: File): Promise<File> {
  if (file.size <= SHRINK_ABOVE_BYTES) return file;
  if (typeof createImageBitmap !== "function" || typeof document === "undefined") return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close?.();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" });
  } catch {
    return file;
  }
}
