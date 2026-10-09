import type { Driver } from '../types.ts';
import { fromDriverRow, paymentFromRow, withPayments } from '../utils.ts';
import { copyFromStored, type AgreementCopy } from './agreements/api.ts';

/** The Supabase rpc call, passed in so this file can be tested without a database. */
export type PortalRpc = (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }>;
/** The part of localStorage used here. */
export type PortalStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export interface PortalSignIn {
  driver: Driver;
  /** The newest agreement staff downloaded for this driver, or null. */
  agreement: (AgreementCopy & { createdAt: string }) | null;
}

/** Why a driver sign-in failed, for the login page to word in the driver's language. */
export type PortalSignInError = 'rate_limited' | 'unavailable';

const KEY = 'eca.driverSession';

/** True when the database does not have the function yet (the SQL file has not been run). */
const isMissingFunction = (error: { message: string; code?: string }) =>
  error.code === 'PGRST202' || error.code === '42883' || /could not find the function|does not exist/i.test(error.message);

const toSignIn = (data: any, nric: string): PortalSignIn => ({
  driver: withPayments(fromDriverRow({ ...data.driver, nric, email: null, address: null, tags: [] }), (data.payments ?? []).map(paymentFromRow)),
  agreement: copyFromStored(data.agreement),
});

/**
 * Driver sign-in on the phone. With "keep me signed in" the server returns a 30-day token, kept in this browser (the
 * NRIC never is); reopening the page sends the token. Works before the SQL is run: it then signs in normally and
 * remembers nothing.
 */
export function driverPortalSession(rpc: PortalRpc, storage: PortalStorage | null) {
  const read = (): { token: string; expiresAt: string } | null => {
    try {
      const saved = JSON.parse(storage?.getItem(KEY) ?? 'null');
      return saved && typeof saved.token === 'string' && typeof saved.expiresAt === 'string' ? saved : null;
    } catch {
      return null;
    }
  };
  const write = (value: { token: string; expiresAt: string }) => {
    try { storage?.setItem(KEY, JSON.stringify(value)); } catch { /* storage blocked: sign in without remembering */ }
  };
  const forget = () => {
    try { storage?.removeItem(KEY); } catch { /* nothing to forget */ }
  };
  const fail = (message: string): never => {
    throw new Error((/too many attempts/i.test(message) ? 'rate_limited' : 'unavailable') satisfies PortalSignInError);
  };

  return {
    /** Signs in with the NRIC. Null when no driver has it; throws `rate_limited` or `unavailable` otherwise. */
    async signIn(nric: string, remember: boolean): Promise<PortalSignIn | null> {
      // Whoever signs in now replaces any driver this phone remembered before (a shared or borrowed phone).
      const previous = read();
      if (previous) {
        forget();
        try { await rpc('driver_portal_forget', { p_token: previous.token }); } catch { /* it expires anyway */ }
      }
      if (remember) {
        const { data, error } = await rpc('driver_portal_login_remember', { p_nric: nric });
        if (!error) {
          const result = data as any;
          if (!result?.driver) return null;
          if (result.session?.token && result.session?.expires_at) write({ token: result.session.token, expiresAt: result.session.expires_at });
          return toSignIn(result, nric);
        }
        if (!isMissingFunction(error)) fail(error.message);
      }
      const { data, error } = await rpc('driver_portal_login', { p_nric: nric });
      if (error) fail(error.message);
      return (data as any)?.driver ? toSignIn(data, nric) : null;
    },

    /**
     * Reopens a remembered phone. Null when nothing is remembered or the token expired (it is then forgotten); throws
     * `unavailable` when the server cannot be reached (the token is kept for next time).
     */
    async resume(): Promise<PortalSignIn | null> {
      const saved = read();
      if (!saved) return null;
      if (!(Date.parse(saved.expiresAt) > Date.now())) {
        forget();
        return null;
      }
      const { data, error } = await rpc('driver_portal_resume', { p_token: saved.token });
      if (error) {
        // The server has no such function (SQL not run): nothing can be remembered.
        if (isMissingFunction(error)) {
          forget();
          return null;
        }
        // Not reachable right now: keep the token for next time.
        throw new Error('unavailable' satisfies PortalSignInError);
      }
      if (!(data as any)?.driver) {
        forget();
        return null;
      }
      return toSignIn(data, '');
    },

    /** True while this phone holds a remembered sign-in. */
    isRemembered: () => read() !== null,

    /** Signs out: the server forgets the token (best effort) and so does this phone. */
    async signOut(): Promise<void> {
      const saved = read();
      forget();
      if (saved) {
        try { await rpc('driver_portal_forget', { p_token: saved.token }); } catch { /* already forgotten here */ }
      }
    },
  };
}
