// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ACCESS_CODE_HEADER, AccessCodeField, accessHeaders } from "./access-code";

beforeEach(() => window.sessionStorage.clear());

describe("accessHeaders", () => {
  it("sends the trimmed code in the access header, and nothing when there is none", () => {
    expect(accessHeaders("  judges-2026 ")).toEqual({ [ACCESS_CODE_HEADER]: "judges-2026" });
    expect(accessHeaders("   ")).toEqual({});
  });
});

describe("AccessCodeField", () => {
  it("is a labelled password field with its hint, and reports what is typed", () => {
    const onChange = vi.fn();
    render(<AccessCodeField id="access-code" value="" onChange={onChange} hint="Needed to send a report." />);
    const input = screen.getByLabelText("Access code");
    expect(input).toHaveAttribute("type", "password");
    expect(input).toHaveAccessibleDescription("Needed to send a report.");
    fireEvent.change(input, { target: { value: "abc" } });
    expect(onChange).toHaveBeenCalledWith("abc");
  });
});
