import { describe, expect, it } from "vitest";

import { newRequestId, REQUEST_ID_HEADER } from "./requestId";

// The API only honours an inbound X-Request-Id matching this shape
// (apps/api/src/app.ts REQUEST_ID_RE); a v4 UUID must satisfy it.
const API_REQUEST_ID_RE = /^[A-Za-z0-9._-]{1,128}$/;

describe("newRequestId", () => {
  it("is the X-Request-Id header name", () => {
    expect(REQUEST_ID_HEADER).toBe("X-Request-Id");
  });

  it("returns a fresh UUID that the API's X-Request-Id filter accepts", () => {
    const a = newRequestId();
    const b = newRequestId();
    expect(a).not.toBe(b);
    expect(a).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    expect(a).toMatch(API_REQUEST_ID_RE);
  });
});
