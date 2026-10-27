"use client";

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
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium">
        Access code
      </label>
      <input
        id={id}
        type="password"
        autoComplete="off"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-describedby={`${id}-hint`}
        className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm sm:w-60"
      />
      <p id={`${id}-hint`} className="text-xs text-muted">
        {hint}
      </p>
    </div>
  );
}
