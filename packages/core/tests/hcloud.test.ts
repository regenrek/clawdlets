import { describe, it, expect, vi, afterEach } from "vitest";
import { ensureHcloudSshKeyId, HCLOUD_REQUEST_TIMEOUT_MS } from "../src/lib/hcloud";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("hcloud timeout", () => {
  it("aborts fetch when timeout elapses", async () => {
    vi.useFakeTimers();

    const fetchMock = vi.fn((_url: string, opts?: { signal?: AbortSignal }) => {
      return new Promise<unknown>((_resolve, reject) => {
        const signal = opts?.signal;
        if (!signal) {
          reject(new Error("missing abort signal"));
          return;
        }
        if (signal.aborted) {
          const err = new Error("aborted");
          (err as Error & { name: string }).name = "AbortError";
          reject(err);
          return;
        }
        signal.addEventListener("abort", () => {
          const err = new Error("aborted");
          (err as Error & { name: string }).name = "AbortError";
          reject(err);
        });
      });
    });

    vi.stubGlobal("fetch", fetchMock);

    const pending = ensureHcloudSshKeyId({
      token: "token",
      name: "clawdlets",
      publicKey: "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIMockKey",
    });

    const assertion = expect(pending).rejects.toThrow(/timed out/i);
    await vi.advanceTimersByTimeAsync(HCLOUD_REQUEST_TIMEOUT_MS);
    await assertion;
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
