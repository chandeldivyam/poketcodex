import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

function encodeDigest(sessionId: string, nonce: string, csrfSecret: string): string {
  return createHmac("sha256", csrfSecret).update(`${sessionId}:${nonce}`).digest("base64url");
}

export function generateCsrfToken(sessionId: string, csrfSecret: string): string {
  const nonce = randomBytes(16).toString("base64url");
  const digest = encodeDigest(sessionId, nonce, csrfSecret);

  return `${nonce}.${digest}`;
}

export function validateCsrfToken(
  token: string,
  sessionId: string,
  csrfSecret: string
): boolean {
  const [nonce, digest] = token.split(".");

  if (!nonce || !digest) {
    return false;
  }

  const expectedDigest = encodeDigest(sessionId, nonce, csrfSecret);

  const digestBuffer = Buffer.from(digest);
  const expectedDigestBuffer = Buffer.from(expectedDigest);

  if (digestBuffer.length !== expectedDigestBuffer.length) {
    return false;
  }

  return timingSafeEqual(digestBuffer, expectedDigestBuffer);
}

export function secureEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}
