import { describe, expect, it } from "vitest";

import { generateCsrfToken, secureEqual, validateCsrfToken } from "../../src/auth/csrf.js";

describe("csrf token helpers", () => {
  it("generates a token that validates for the same session", () => {
    const token = generateCsrfToken("session-id", "csrf-secret-for-tests-123456789012");

    expect(validateCsrfToken(token, "session-id", "csrf-secret-for-tests-123456789012")).toBe(true);
  });

  it("fails validation for tampered tokens", () => {
    const token = generateCsrfToken("session-id", "csrf-secret-for-tests-123456789012");
    const tamperedToken = `${token}x`;

    expect(validateCsrfToken(tamperedToken, "session-id", "csrf-secret-for-tests-123456789012")).toBe(
      false
    );
  });

  it("compares secrets in constant-time style", () => {
    expect(secureEqual("same-value", "same-value")).toBe(true);
    expect(secureEqual("same-value", "different-value")).toBe(false);
  });
});
