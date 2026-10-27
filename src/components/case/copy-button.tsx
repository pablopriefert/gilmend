"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";
import { BUTTON_QUIET } from "./ui";
import { useCaseToast } from "./toast-host";

/**
 * Copies a text to the clipboard. The button says "Copied" for two seconds and a toast confirms;
 * when the browser refuses (no permission, insecure context) `onError` says so in the page.
 */
export function CopyButton({
  text,
  label,
  copiedLabel = "Copied",
  toastTitle,
  disabled,
  onError,
  className,
}: {
  text: string;
  label: string;
  copiedLabel?: string;
  toastTitle: string;
  disabled?: boolean;
  onError?: () => void;
  className?: string;
}) {
  const notify = useCaseToast();
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      notify({ title: toastTitle });
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      onError?.();
    }
  }

  const Icon = copied ? Check : Copy;
  return (
    <button type="button" className={cn(BUTTON_QUIET, className)} disabled={disabled} onClick={() => void copy()}>
      <Icon aria-hidden="true" className="h-4 w-4" strokeWidth={1.75} />
      {copied ? copiedLabel : label}
    </button>
  );
}
