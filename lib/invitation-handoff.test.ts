import { describe, expect, it, vi } from "vitest";
import { prepareInvitationHandoff } from "@/lib/invitation-handoff";

describe("prepareInvitationHandoff", () => {
  it("signs out the existing account before exposing the invitation sign-in route", async () => {
    const calls: string[] = [];
    const replaceUrl = vi.fn((url: string) => calls.push(`replace:${url}`));

    const handled = await prepareInvitationHandoff({
      href: "https://student-assessment-app.vercel.app/?invited=1&source=email#signin",
      waitForAuthReady: async () => { calls.push("ready"); },
      hasCurrentUser: () => true,
      signOutCurrentUser: async () => { calls.push("signout"); },
      replaceUrl
    });

    expect(handled).toBe(true);
    expect(calls).toEqual(["ready", "signout", "replace:/?source=email#signin"]);
  });

  it("does nothing when the invitation marker is absent", async () => {
    const waitForAuthReady = vi.fn(async () => {});
    const signOutCurrentUser = vi.fn(async () => {});
    const replaceUrl = vi.fn();

    const handled = await prepareInvitationHandoff({
      href: "http://localhost:3021/",
      waitForAuthReady,
      hasCurrentUser: () => true,
      signOutCurrentUser,
      replaceUrl
    });

    expect(handled).toBe(false);
    expect(waitForAuthReady).not.toHaveBeenCalled();
    expect(signOutCurrentUser).not.toHaveBeenCalled();
    expect(replaceUrl).not.toHaveBeenCalled();
  });
});
