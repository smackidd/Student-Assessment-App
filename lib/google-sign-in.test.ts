import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Auth } from "firebase/auth";

const mocks = vi.hoisted(() => ({ popup: vi.fn(), signOut: vi.fn(), parameters: vi.fn() }));
vi.mock("firebase/auth", () => ({
  GoogleAuthProvider: class { setCustomParameters = mocks.parameters; },
  signInWithPopup: mocks.popup,
  signOut: mocks.signOut
}));

import { googleSignInError, isSchoolEmail, signInWithSchoolGoogle } from "./google-sign-in";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.signOut.mockResolvedValue(undefined);
});

describe("school Google sign-in", () => {
  it.each(["teacher@foothillsacademy.org", " Teacher@FoothillsAcademy.ORG "])("accepts school address %s", (email) => {
    expect(isSchoolEmail(email)).toBe(true);
  });

  it.each(["teacher@gmail.com", "teacher@sub.foothillsacademy.org", "teacher@foothillsacademy.org.evil.test", "@foothillsacademy.org", "teacher@@foothillsacademy.org", "teacher name@foothillsacademy.org", "foothillsacademy.org"])("rejects address %s", (email) => {
    expect(isSchoolEmail(email)).toBe(false);
  });

  it("opens the account chooser with a school hint and accepts a verified school user", async () => {
    const user = { email: "teacher@foothillsacademy.org", emailVerified: true };
    mocks.popup.mockResolvedValue({ user });
    const auth = {} as Auth;
    expect(await signInWithSchoolGoogle(auth)).toBe(user);
    expect(mocks.parameters).toHaveBeenCalledWith({ hd: "foothillsacademy.org", prompt: "select_account" });
    expect(mocks.popup).toHaveBeenCalledWith(auth, expect.anything());
    expect(mocks.signOut).not.toHaveBeenCalled();
  });

  it.each([
    { email: "teacher@gmail.com", emailVerified: true },
    { email: "teacher@foothillsacademy.org", emailVerified: false },
    { email: null, emailVerified: true }
  ])("clears the session after an invalid Google result: %j", async (user) => {
    mocks.popup.mockResolvedValue({ user });
    const auth = {} as Auth;
    await expect(signInWithSchoolGoogle(auth)).rejects.toThrow("Use your invited foothillsacademy.org Google account.");
    expect(mocks.signOut).toHaveBeenCalledWith(auth);
  });

  it("preserves server rejection without accepting a result", async () => {
    const failure = Object.assign(new Error("Invitation required"), { code: "auth/internal-error" });
    mocks.popup.mockRejectedValue(failure);
    await expect(signInWithSchoolGoogle({} as Auth)).rejects.toBe(failure);
    expect(mocks.signOut).not.toHaveBeenCalled();
  });

  it.each([
    ["auth/popup-blocked", "Allow pop-ups"],
    ["auth/popup-closed-by-user", "cancelled"],
    ["auth/operation-not-allowed", "not available"],
    ["auth/unauthorized-domain", "not available"],
    ["auth/account-exists-with-different-credential", "Contact your administrator"],
    ["auth/internal-error", "exact foothillsacademy.org account"]
  ])("explains recoverable failure %s", (code, message) => {
    expect(googleSignInError({ code })).toContain(message);
  });
});
