import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getAllAds, saveAd } from "./src/storage/indexeddb.js";

function createFakeIndexedDB() {
  const records = new Map();
  let hasStore = false;

  return {
    open() {
      const request = { result: null, error: null };

      setTimeout(() => {
        const db = {
          objectStoreNames: {
            contains(name) {
              return hasStore && name === "ads";
            }
          },
          createObjectStore(name) {
            if (name === "ads") {
              hasStore = true;
            }
          },
          transaction(_name, _mode) {
            const tx = { oncomplete: null, onerror: null };
            const store = {
              put(value) {
                const req = { onsuccess: null, onerror: null, error: null };
                setTimeout(() => {
                  try {
                    if (!value || !value.id || typeof value.snapshot === "undefined" || typeof value.analysis === "undefined") {
                      throw new Error("invalid_ad_object");
                    }
                    records.set(value.id, value);
                    if (req.onsuccess) req.onsuccess();
                    if (tx.oncomplete) tx.oncomplete();
                  } catch (error) {
                    req.error = error;
                    if (req.onerror) req.onerror();
                    if (tx.onerror) tx.onerror();
                  }
                }, 0);
                return req;
              },
              getAll() {
                const req = { onsuccess: null, onerror: null, result: null, error: null };
                setTimeout(() => {
                  req.result = Array.from(records.values());
                  if (req.onsuccess) req.onsuccess();
                  if (tx.oncomplete) tx.oncomplete();
                }, 0);
                return req;
              }
            };

            tx.objectStore = () => store;
            return tx;
          },
          close() {}
        };

        request.result = db;
        if (!hasStore) {
          if (request.onupgradeneeded) request.onupgradeneeded();
        }
        if (request.onsuccess) request.onsuccess();
      }, 0);

      return request;
    }
  };
}

describe("indexeddb", () => {
  beforeEach(() => {
    globalThis.indexedDB = createFakeIndexedDB();
  });

  afterEach(() => {
    delete globalThis.indexedDB;
  });

  it("should save ad", async () => {
    const ad = { id: "1", snapshot: {}, analysis: {}, created_at: "2026-05-05T00:00:00.000Z" };
    const saved = await saveAd(ad);

    expect(saved).toEqual(ad);
    expect(saved).toHaveProperty("id");
    expect(saved).toHaveProperty("snapshot");
    expect(saved).toHaveProperty("analysis");
  });

  it("should retrieve ads", async () => {
    await saveAd({ id: "a", snapshot: {}, analysis: {}, created_at: "2026-05-05T00:00:00.000Z" });
    await saveAd({ id: "b", snapshot: {}, analysis: {}, created_at: "2026-05-05T00:00:00.000Z" });

    const ads = await getAllAds();
    expect(ads.length).toBe(2);
  });

  it("should return array", async () => {
    const ads = await getAllAds();
    expect(Array.isArray(ads)).toBe(true);
  });

  it("should fail for invalid object", async () => {
    await expect(
      saveAd({ snapshot: {}, analysis: {}, created_at: "2026-05-05T00:00:00.000Z" })
    ).rejects.toBeTruthy();
  });
});
