import { describe, expect, it } from "vitest";

import { formatSeconds, parseBackendTimestamp } from "./time";

describe("formatSeconds", () => {
  it("formats values with leading zeros", () => {
    expect(formatSeconds(65)).toBe("01:05");
  });

  it("clamps negative values", () => {
    expect(formatSeconds(-4)).toBe("00:00");
  });
});

describe("parseBackendTimestamp", () => {
  it("treats timezone-less backend timestamps as UTC", () => {
    const parsed = parseBackendTimestamp("2026-04-12T00:00:00");
    expect(parsed.toISOString()).toBe("2026-04-12T00:00:00.000Z");
  });

  it("preserves explicit UTC timestamps", () => {
    const parsed = parseBackendTimestamp("2026-04-12T00:00:00Z");
    expect(parsed.toISOString()).toBe("2026-04-12T00:00:00.000Z");
  });
});
