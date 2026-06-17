import { HttpsError } from "firebase-functions/v2/https";
import { expect } from "vitest";

// Build a CallableRequest-shaped object for a v2 onCall handler's `.run()`.
// requireRole/requireAuth read `auth.uid` + `auth.token.role`/`roles`, so we
// mirror that shape. Pass `uid: null` to simulate an unauthenticated call.
export function makeRequest<T>(opts: {
  data: T;
  uid?: string | null;
  role?: string;
  roles?: string[];
}): unknown {
  const { data, uid = "u_test", role, roles } = opts;
  const auth =
    uid === null
      ? undefined
      : { uid, token: { ...(role ? { role } : {}), ...(roles ? { roles } : {}) } };
  return { data, auth, rawRequest: { headers: {} }, acceptsStreaming: false };
}

// Invoke a v2 callable's underlying handler directly (bypasses the App
// Check / auth gateway — that's what `.run` is for).
export async function callFn<R>(
  fn: { run: (req: unknown) => R | Promise<R> },
  req: unknown,
): Promise<R> {
  return await fn.run(req);
}

// Assert that invoking the callable throws an HttpsError with the given code.
export async function expectHttpsError(
  promise: Promise<unknown>,
  code: string,
): Promise<HttpsError> {
  try {
    await promise;
  } catch (e) {
    expect(e).toBeInstanceOf(HttpsError);
    expect((e as HttpsError).code).toBe(code);
    return e as HttpsError;
  }
  throw new Error(`expected HttpsError(${code}) but the call resolved`);
}
