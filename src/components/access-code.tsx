"use client";

import { KeyRound } from "lucide-react";
import { useEffect, useState } from "react";

// The public demo can be protected by a shared access code (DAMAGE_DESK_ACCESS_CODE, see
// src/app/api/_lib/access.ts). The visitor types it once; it is kept in sessionStorage for
// the tab only. Storage can throw (private mode, blocked cookies): then the code just has to
// be typed again.

const KEY = "damage-desk-access-code";

export const ACCESS_CODE_HEADER = "x-access-code";

function read(): string {
  try {
    return window.sessionStorage.getItem(KEY) ?? "";
  } catch {
    return "";
  }
}

function write(value: string): void {
  try {
    if (value) window.sessionStorage.setItem(KEY, value);
    else window.sessionStorage.removeItem(KEY);
  } catch {
    // keep the value in memory only
  }
}

/** The code typed in this tab, and a setter that remembers it. */
export function useAccessCode(): [string, (value: string) => void] {
  const [code, setCode] = useState("");
  useEffect(() => {
    // Read after mount so the server and the first client render agree.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-off read of sessionStorage
    setCode(read());
  }, []);
  return [
    code,
    (value: string) => {
      setCode(value);
      write(value.trim());
    },
  ];
}

export function accessHeaders(code: string): Record<string, string> {
  return code.trim() ? { [ACCESS_CODE_HEADER]: code.trim() } : {};
}

export function AccessCodeField({
  id,
  value,
  onChange,
  hint,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  hint: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-foreground">
        Access code
      </label>
      <div className="relative sm:max-w-xs">
        <KeyRound
          aria-hidden="true"
          strokeWidth={1.75}
          className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted"
        />
        <input
          id={id}
          type="password"
          autoComplete="off"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-describedby={`${id}-hint`}
          className="h-11 w-full rounded-lg border border-border-strong/70 bg-surface pl-10 pr-3.5 text-[0.9375rem] text-foreground transition-[border-color] duration-150 hover:border-border-strong focus:border-ink"
        />
      </div>
      <p id={`${id}-hint`} className="text-xs leading-5 text-muted">
        {hint}
      </p>
    </div>
  );
}
