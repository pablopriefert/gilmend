import { existsSync } from "node:fs";
import path from "node:path";

// Where the photos of the six demo cases really are.
//
// The cases name each photo `data/photos/<name>.jpg`: the name of the real photo we will
// shoot ourselves. Until that exists, `data/photos/<name>.webp` holds a PROVISIONAL stand-in
// (an AI-generated image: its XMP says trainedAlgorithmicMedia), saved under its true format.
// The shot of the team always wins over the stand-in; see data/photos/README.md.

export const DEMO_PHOTO_EXTENSIONS = [".jpg", ".webp"] as const;

/** The file to use for a photo path of a demo case, or null when neither version exists. */
export function resolveDemoPhoto(photoPath: string, root: string = process.cwd()): string | null {
  const stem = photoPath.replace(/\.[a-z0-9]+$/i, "");
  for (const ext of DEMO_PHOTO_EXTENSIONS) {
    // The folder is computed at run time on purpose; next.config.ts lists data/photos for the
    // deployment, so the bundler must not trace the whole project for these two calls.
    const candidate = path.join(/*turbopackIgnore: true*/ root, `${stem}${ext}`);
    if (existsSync(/*turbopackIgnore: true*/ candidate)) return candidate;
  }
  return null;
}

/** True when the photo in use is a provisional stand-in and not a photo taken by the team. */
export function isProvisionalDemoPhoto(file: string): boolean {
  return file.toLowerCase().endsWith(".webp");
}
