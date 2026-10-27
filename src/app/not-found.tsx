import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-md py-16 text-center">
      <h1 className="text-2xl font-semibold tracking-tight">Case not found</h1>
      <p className="mt-2 text-sm text-muted">This page or case does not exist (or was removed).</p>
      <Link
        href="/"
        className="mt-6 inline-block rounded-md bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-hover"
      >
        Back to cases
      </Link>
    </div>
  );
}
