import { describe, expect, it, vi } from "vitest";

// Simulate a later spec (06.2) registering another user-data prefix, as
// `USER_DATA_KEY_PREFIXES` tells it to: every `sin:` key now counts as user data.
vi.mock("../../storage/clearUserData", () => ({
  isUserDataKey: (key: string) => key.startsWith("sin:"),
}));

import type { ApiClient } from "../../api/client";
import { memoryStorageAdapter } from "../../storage/storage";
import { createCatalogStore } from "./catalogStore";
import { catalogKey } from "./constants";

const USER = "018f4e8a-1c2d-4f3a-8b6c-9d0e1f2a3b4c";
const OTHER_USER = "018f4e8a-1c2d-4f3a-8b6c-9d0e1f2a3b4d";

describe("AC13 — the construction sweep only removes the catalog's own keys", () => {
  it("leaves a key under another registered user-data prefix alone", () => {
    const storage = memoryStorageAdapter({
      [`sin:outbox:v1:${USER}`]: "{}",
      [catalogKey(OTHER_USER)]: "{}",
    });

    createCatalogStore({
      api: { request: vi.fn(), post: vi.fn() } as unknown as Pick<ApiClient, "request" | "post">,
      storage,
      userId: USER,
    });

    expect(storage.keys()).toEqual([`sin:outbox:v1:${USER}`]);
  });
});
