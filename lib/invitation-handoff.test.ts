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

    expect(handled).toBe("password");
    expect(calls).toEqual(["ready", "signout", "replace:/?source=email#signin"]);
  });

  it("identifies Google invitations separately from previously sent password links", async () => {
    const replaceUrl = vi.fn();
    const signOutCurrentUser = vi.fn(async () => {});
    const handled = await prepareInvitationHandoff({
      href: "http://localhost:3058/?invited=google&source=email",
      waitForAuthReady: async () => {},
      hasCurrentUser: () => false,
      signOutCurrentUser,
      replaceUrl
    });
    expect(handled).toBe("google");
    expect(replaceUrl).toHaveBeenCalledWith("/?source=email");
    expect(signOutCurrentUser).not.toHaveBeenCalled();
  });

  it("retains the handoff and refuses to continue when the previous account cannot sign out", async () => {
    const replaceUrl = vi.fn();
    await expect(prepareInvitationHandoff({
      href: "http://localhost:3058/?invited=google",
      waitForAuthReady: async () => {},
      hasCurrentUser: () => true,
      signOutCurrentUser: async () => { throw new Error("Sign-out failed"); },
      replaceUrl
    })).rejects.toThrow("Sign-out failed");
    expect(replaceUrl).not.toHaveBeenCalled();
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
