import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import LoginView from './components/LoginView';
import DriverDashboard from './components/DriverDashboard';
import AdminDashboard from './components/AdminDashboard';
import CollectionsDataPage from './components/CollectionsDataPage';
import WorklistPage from './components/WorklistPage';
import type { Driver, PaymentTransaction } from './types';
import { kualaLumpurNow, kualaLumpurToday, fromDriverRow, toDriverRow, paymentFromRow, withPayments } from './utils';
import { driverPortalSession, type PortalSignIn } from './services/driverPortalSession';
import { loadPortalLang, savePortalLang, type PortalLang } from './services/portalText';
import { supabase } from './supabaseClient';
import { Database, UploadCloud, RefreshCw } from 'lucide-react';
import { Session } from '@supabase/supabase-js';
import { signInWithAccessId } from './services/accessIdAuth';
import { readAllRows } from './services/pagedRead';
import { addDeposit } from './services/depositsApi';
import type { UpfrontReceived } from './services/depositTotals';
import { writeTodaysSnapshotOnce } from './services/dailyStatus';
import { saveDailyStatus } from './services/collectionsApi';
import Notice, { type NoticeMessage } from './components/Notice';
import { buildAdminPath, parseAdminPath, resolveAdminRoute, type StoredViews } from './services/routes';
import { applyLiveChanges, latestChangedAt, refreshKind, unseenChanges, type LiveMode } from './services/liveChanges';
import { readChangeCursors, readDriverRows, readLiveChanges } from './services/liveChangesApi';

/** This browser's storage, or null when the browser blocks it. */
const browserStorage = (): Storage | null => {
  try { return window.localStorage; } catch { return null; }
};

/** The day this page last tried to write the daily status snapshot (see writeTodaysSnapshotOnce). */
const snapshotAttempt = { day: null as string | null };

/** The tabs this browser saved before pages had addresses; they still pick the first page for "/" or "/admin". */
const storedViews = (): StoredViews => {
  const read = (key: string) => { try { return browserStorage()?.getItem(key) ?? null; } catch { return null; } };
  return { section: read('eca_admin_section'), moneyPage: read('eca_admin_money_page'), legacyView: read('eca_admin_view_mode') };
};

const App: React.FC = () => {
  // Driver and payment records load only after a staff or admin signs in, and are cleared when they sign out.
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [dataLoaded, setDataLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [currentView, setCurrentView] = useState<'LOGIN' | 'DRIVER' | 'ADMIN'>('LOGIN');
  // The address (History API): admin pages have their own; the login and the driver's phone page stay on "/". A link
  // opened while signed out keeps its address, so it opens after the staff or admin sign-in.
  const [path, setPath] = useState(() => window.location.pathname);
  useEffect(() => {
    const followHistory = () => setPath(window.location.pathname);
    window.addEventListener('popstate', followHistory);
    return () => window.removeEventListener('popstate', followHistory);
  }, []);
  /** Goes to an address: a new history entry, or with `replace` the current one changed (no extra Back step). */
  const navigate = useCallback((to: string, options: { replace?: boolean } = {}) => {
    if (to !== window.location.pathname) {
      if (options.replace) window.history.replaceState(null, '', to);
      else window.history.pushState(null, '', to);
    }
    setPath(to);
  }, []);
  // A signed-in driver's own record, from the driver sign-in (never the driver list). The NRIC typed this visit is kept
  // in memory only, for Refresh; a remembered phone holds a 30-day token instead.
  const [portal, setPortal] = useState<{ driver: Driver; agreement: PortalSignIn['agreement']; nric: string; loadedAt: Date } | null>(null);
  const portalSession = useMemo(() => driverPortalSession((name, args) => supabase.rpc(name, args), browserStorage()), []);
  const [portalLang, setPortalLang] = useState<PortalLang>(() => loadPortalLang(browserStorage()));
  const changePortalLang = useCallback((lang: PortalLang) => {
    setPortalLang(lang);
    savePortalLang(browserStorage(), lang);
  }, []);

  // Auth State
  const [, setSession] = useState<Session | null>(null);
  const [userRole, setUserRole] = useState<'admin' | 'staff' | null>(null);
  const [isAuthChecking, setIsAuthChecking] = useState(true);
  const authGeneration = useRef(0);
  const currentViewRef = useRef(currentView);
  const authenticatedUserIdRef = useRef<string | null>(null);

  // Save errors and confirmations shown in a message bar instead of browser alert boxes
  const [notice, setNotice] = useState<NoticeMessage | null>(null);
  const dismissNotice = useCallback(() => setNotice(null), []);
  // When the full driver and payment list was last loaded (payments saved here update one driver only), and when a
  // payment was last changed here (a background reload that started earlier must not overwrite it)
  const lastFullLoad = useRef(0);
  const lastLocalChange = useRef(0);
  // Live updates (services/liveChanges.ts): the Kuala Lumpur day of the last full load, where the next read of each change
  // log starts, the change rows already applied, and the list as last rendered
  const fullLoadDay = useRef('');
  const live = useRef<{ mode: LiveMode; payments: string | null; drivers: string | null; seenPayments: Set<number>; seenDrivers: Set<number> }>(
    { mode: 'off', payments: null, drivers: null, seenPayments: new Set(), seenDrivers: new Set() });
  const lightReadBusy = useRef(false);
  const hiddenAt = useRef<number | null>(null);
  /** When the last read failed (cleared by a successful one): refreshes back off to every 3 minutes meanwhile. */
  const lastFailure = useRef<number | null>(null);
  const driversRef = useRef(drivers);
  driversRef.current = drivers;

  useEffect(() => {
    currentViewRef.current = currentView;
  }, [currentView]);

  // --- Data Fetching ---
  const fetchDriversAndPayments = async (silent: boolean = false, background: boolean = false) => {
    const startedAt = Date.now();
    try {
      if (!silent) {
        setLoading(true);
      }
      setError(null);

      // Timeout Promise
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Connection timed out. Please check your network or API configuration.')), 15000)
      );

      // Actual Data Fetch
      const fetchData = async () => {
        // Where live updates start from: the latest change logged before this snapshot is read
        const cursors = await readChangeCursors();
        const driversData = await readAllRows<any>(() => supabase.from('drivers').select('*'), 'created_at', false);
        const paymentsData = await readAllRows<any>(() => supabase.from('payments').select('*'), 'date', false);
        
        const paymentsByDriver = new Map<string, PaymentTransaction[]>();
        for (const row of paymentsData || []) {
            const list = paymentsByDriver.get(row.driver_id) ?? [];
            list.push(paymentFromRow(row));
            paymentsByDriver.set(row.driver_id, list);
        }
        const formattedDrivers: Driver[] = (driversData || []).map((d: any) => withPayments(fromDriverRow(d), paymentsByDriver.get(d.id) ?? []));

        return { formattedDrivers, cursors };

      };

      // Race the fetch against the timeout
      const result = (await Promise.race([fetchData(), timeoutPromise])) as { formattedDrivers: Driver[]; cursors: Awaited<ReturnType<typeof readChangeCursors>> };
      if (currentViewRef.current !== 'ADMIN') return; // signed out while loading: keep nothing
      if (background && lastLocalChange.current >= startedAt) return; // a payment saved meanwhile would be lost; the next reload catches up
      setDrivers(result.formattedDrivers);
      setDataLoaded(true);
      lastFullLoad.current = Date.now();
      lastFailure.current = null;
      fullLoadDay.current = kualaLumpurToday();
      live.current = { ...result.cursors, seenPayments: new Set(), seenDrivers: new Set() };
      // The first full load of the Kuala Lumpur day records each active driver's status; silent if it cannot
      void writeTodaysSnapshotOnce({
        drivers: result.formattedDrivers, now: kualaLumpurNow(), today: kualaLumpurToday(), storage: browserStorage(),
        write: saveDailyStatus, attempted: snapshotAttempt,
      });
    } catch (err: any) {
      lastFailure.current = Date.now();
      console.error('Error fetching data:', err);
      setError(err.message || 'Failed to connect to database');
    } finally {
      setLoading(false);
    }
  };

  const fetchUserRole = useCallback(async (userId: string, generation: number) => {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', userId)
        .single();

      if (generation !== authGeneration.current) return;
      if (error || !data || (data.role !== 'admin' && data.role !== 'staff')) {
        throw error || new Error('A valid profile role is required.');
      }
      setUserRole(data.role);
      setCurrentView('ADMIN');
    } catch (e) {
      if (generation !== authGeneration.current) return;
      console.error('Profile fetch exception', e);
      setSession(null);
      setUserRole(null);
      setCurrentView('LOGIN');
      void supabase.auth.signOut();
    } finally {
      if (generation === authGeneration.current) setIsAuthChecking(false);
    }
  }, []);

  // --- Auth & Session Management ---
  useEffect(() => {
    let isActive = true;
    const refreshRoleAfterAuthEvent = (nextSession: Session) => {
      const userChanged = authenticatedUserIdRef.current !== nextSession.user.id;
      const shouldResolveRole =
        userChanged || currentViewRef.current === 'LOGIN';

      authenticatedUserIdRef.current = nextSession.user.id;
      if (!shouldResolveRole) return;

      const generation = ++authGeneration.current;
      setIsAuthChecking(true);
      window.setTimeout(() => {
        if (isActive && generation === authGeneration.current) {
          void fetchUserRole(nextSession.user.id, generation);
        }
      }, 0);
    };

    const restoreSession = async () => {
      const generation = authGeneration.current;
      const { data: { session: restoredSession }, error: sessionError } = await supabase.auth.getSession();
      if (!isActive || generation !== authGeneration.current) return;
      if (sessionError) {
        authGeneration.current++;
        console.warn('Session check error:', sessionError);
        setSession(null);
        setUserRole(null);
        authenticatedUserIdRef.current = null;
        setCurrentView('LOGIN');
        setIsAuthChecking(false);
        void supabase.auth.signOut();
        return;
      }

      setSession(restoredSession);
      if (restoredSession) {
        refreshRoleAfterAuthEvent(restoredSession);
      } else {
        // No staff sign-in: reopen a driver's page if this phone was remembered
        const resumed = await portalSession.resume().catch(() => null);
        if (!isActive || generation !== authGeneration.current) return;
        if (resumed) {
          setPortal({ driver: resumed.driver, agreement: resumed.agreement, nric: '', loadedAt: new Date() });
          setCurrentView('DRIVER');
        }
        setIsAuthChecking(false);
      }
    };

    void restoreSession();
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (event === 'SIGNED_OUT' || (event as string) === 'USER_DELETED') {
        authGeneration.current++;
        authenticatedUserIdRef.current = null;
        setDrivers([]);
        setDataLoaded(false);
        setSession(null);
        setUserRole(null);
        setCurrentView('LOGIN');
        setIsAuthChecking(false);
        if (window.location.pathname !== '/') { window.history.replaceState(null, '', '/'); setPath('/'); }
        return;
      }

      if ((event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') && nextSession) {
        setSession(nextSession);
        // Supabase calls are deferred so the auth callback can finish cleanly.
        refreshRoleAfterAuthEvent(nextSession);
      }
    });

    return () => {
      isActive = false;
      authGeneration.current++;
      subscription.unsubscribe();
    };
  }, [fetchUserRole]);

  // Staff and admins get the driver list once signed in; nothing is loaded on the login page.
  useEffect(() => {
    if (currentView === 'ADMIN') void fetchDriversAndPayments();
  }, [currentView]);

  /**
   * Live update: reads only the payment and driver changes logged since the last look and applies them to the list
   * (changed drivers are read again, one row each). Reloads in full instead when the read fails, a log had too many rows
   * or a payment belongs to a driver not in the list. Nothing is applied when a payment was saved in this tab meanwhile:
   * the next read catches up (the change logs keep everything).
   */
  const lightRead = async () => {
    const state = live.current;
    if (lightReadBusy.current || state.mode === 'off' || currentViewRef.current !== 'ADMIN') return;
    lightReadBusy.current = true;
    const startedAt = Date.now();
    try {
      const read = await readLiveChanges({ payments: state.payments, drivers: state.drivers }, state.mode === 'all');
      if (read.tooMany) {
        void fetchDriversAndPayments(true, true);
        return;
      }
      const paymentRows = unseenChanges(read.payments, state.seenPayments);
      const driverChanges = unseenChanges(read.drivers, state.seenDrivers);
      const driverRows = await readDriverRows([...new Set(driverChanges.map(change => change.driver_id))]);
      // Signed out, or a full load replaced the list meanwhile (it starts its own cursors)
      if (currentViewRef.current !== 'ADMIN' || live.current !== state) return;
      if (lastLocalChange.current >= startedAt) return; // a payment saved here meanwhile; the next read catches up
      const changes = { payments: paymentRows, driverRows };
      if (applyLiveChanges(driversRef.current, changes).unknownDrivers.length) {
        void fetchDriversAndPayments(true, true);
        return;
      }
      if (paymentRows.length || driverRows.size) setDrivers(prev => applyLiveChanges(prev, changes).drivers);
      for (const row of paymentRows) state.seenPayments.add(row.id);
      for (const row of driverChanges) state.seenDrivers.add(row.id);
      state.payments = latestChangedAt(read.payments, state.payments);
      state.drivers = latestChangedAt(read.drivers, state.drivers);
      lastFailure.current = null;
    } catch (err) {
      // Back off while the database is unreachable: one full reload now, then at most one try every 3 minutes
      const backingOff = lastFailure.current !== null;
      lastFailure.current = Date.now();
      console.warn('Live update failed', err);
      if (!backingOff) void fetchDriversAndPayments(true, true);
    } finally {
      lightReadBusy.current = false;
    }
  };

  // Payments saved here update one driver only; what other staff save arrives with a light read of the changes every
  // minute while this tab is in view, and when it comes back into view. A full reload on a new day, on return after more
  // than 10 minutes away, and on the old 3-minute schedule where a change log is not available (see refreshKind).
  useEffect(() => {
    const refresh = (trigger: 'timer' | 'return') => {
      if (document.visibilityState !== 'visible' || currentViewRef.current !== 'ADMIN') return;
      const now = Date.now();
      const kind = refreshKind(trigger, {
        now, lastFullLoad: lastFullLoad.current, fullLoadDay: fullLoadDay.current, today: kualaLumpurToday(), live: live.current.mode,
        lastFailure: lastFailure.current, awayMs: hiddenAt.current === null ? 0 : now - hiddenAt.current,
      });
      if (kind === 'full') void fetchDriversAndPayments(true, true);
      else if (kind === 'light') void lightRead();
    };
    const onTimer = () => refresh('timer');
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        hiddenAt.current = Date.now();
        return;
      }
      refresh('return');
      hiddenAt.current = null;
    };
    const timer = window.setInterval(onTimer, 60_000);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  // --- Login Handlers ---

  /**
   * Signs a driver in on the server and opens their own dashboard. Returns false when no driver has this NRIC; throws
   * Error('rate_limited') or Error('unavailable'). With `remember`, this phone stays signed in for 30 days.
   */
  const handleDriverLogin = async (nric: string, remember: boolean): Promise<boolean> => {
    const signedIn = await portalSession.signIn(nric, remember);
    if (!signedIn) return false;
    setPortal({ driver: signedIn.driver, agreement: signedIn.agreement, nric, loadedAt: new Date() });
    setCurrentView('DRIVER');
    return true;
  };

  /**
   * Reloads the signed-in driver's record: with this phone's remembered sign-in when there is one, else the NRIC typed
   * this visit. When the sign-in has expired or the driver is gone, returns to the login page. Rejects with
   * `rate_limited` or `unavailable` when it cannot reload now.
   */
  const handleDriverRefresh = async () => {
    const reloaded = portalSession.isRemembered()
      ? await portalSession.resume()
      : portal?.nric ? await portalSession.signIn(portal.nric, false) : null;
    if (!reloaded) {
      setPortal(null);
      setCurrentView('LOGIN');
      return;
    }
    const { driver, agreement } = reloaded;
    setPortal(current => ({ driver, agreement, nric: current?.nric ?? '', loadedAt: new Date() }));
  };

  const handleAdminLogin = async (accessId: string) => {
    await signInWithAccessId(accessId);
  };

  const handleLogout = async () => {
    if (currentView === 'ADMIN') {
      await supabase.auth.signOut();
    }
    if (currentView === 'DRIVER') {
      await portalSession.signOut();
    }
    setCurrentView('LOGIN');
    setPortal(null);
    setDrivers([]);
    setDataLoaded(false);
    setUserRole(null);
    setNotice(null);
    navigate('/', { replace: true });
  };

  // --- CRUD Operations (Passed to AdminDashboard) ---

  /** Replaces one driver's payments and recomputes that driver's totals; other drivers are untouched. */
  const updateDriverPayments = (driverId: string, update: (payments: PaymentTransaction[]) => PaymentTransaction[]) => {
    lastLocalChange.current = Date.now();
    setDrivers(prev => prev.map(d => (d.id === driverId ? withPayments(d, update(d.paymentHistory)) : d)));
  };
  // Whole rows, so columns added later (such as the reference) come back without a change here
  const PAYMENT_COLUMNS = '*';

  const handleUpdatePayment = async (driverId: string, amount: number, date: string, serviceClaim: number = 0, paymentMethod: 'BANK TRANSFER' | 'CASH DEPOSIT' | 'CASH' | 'DEPOSIT CONTRA' | 'CLAIM' = 'BANK TRANSFER', reference?: string, receivedInto?: string) => {
    // Shown straight away, then swapped for the saved row; the rest of the list is not reloaded.
    const tempId = `temp-${Date.now()}`;
    updateDriverPayments(driverId, payments => [{ id: tempId, amount, serviceClaim, date, paymentMethod, ...(reference ? { reference } : {}), ...(receivedInto ? { receivedInto } : {}) }, ...payments]);
    try {
      // The reference and account are sent only when set, so recording a payment never depends on those columns otherwise
      const { data, error } = await supabase
        .from('payments')
        .insert({ driver_id: driverId, amount, service_claim: serviceClaim, date, payment_method: paymentMethod, ...(reference ? { reference } : {}), ...(receivedInto ? { received_into: receivedInto } : {}) })
        .select(PAYMENT_COLUMNS)
        .single();
      if (error) throw error;
      const saved = paymentFromRow(data);
      // Swap the placeholder for the saved row. If the row already arrived (a reload or a live update), only drop the
      // placeholder; if a reload replaced the list without it, add the row.
      updateDriverPayments(driverId, payments => payments.some(p => p.id === saved.id)
        ? payments.filter(p => p.id !== tempId)
        : payments.some(p => p.id === tempId) ? payments.map(p => (p.id === tempId ? saved : p)) : [saved, ...payments]);
    } catch (err: any) {
      updateDriverPayments(driverId, payments => payments.filter(p => p.id !== tempId));
      const sameReference = err?.code === '23505' && /payments_reference_once/.test(err?.message ?? '');
      setNotice({ type: 'error', text: sameReference ? `Payment not saved: reference ${reference} is already recorded for this driver.` : `Payment not saved: ${err.message}` });
      await fetchDriversAndPayments(true);
    }
  };

  const handleEditPayment = async (paymentId: string, amount: number, serviceClaim: number, date: string, paymentMethod?: 'BANK TRANSFER' | 'CASH DEPOSIT' | 'CASH' | 'DEPOSIT CONTRA' | 'CLAIM', reference?: string, receivedInto?: string | null) => {
    const driver = drivers.find(d => d.paymentHistory.some(p => p.id === paymentId));
    const current = driver?.paymentHistory.find(p => p.id === paymentId);
    if (!driver || !current) return;
    const driverId = driver.id;
    // The reference and account are written only when they changed (cleared to null when removed)
    const referenceChanged = reference !== undefined && reference !== (current.reference ?? '');
    const accountChanged = receivedInto !== undefined && (receivedInto || null) !== (current.receivedInto ?? null);
    updateDriverPayments(driverId, payments => payments.map(p => {
      if (p.id !== paymentId) return p;
      const next: PaymentTransaction = { ...p, amount, serviceClaim, date, paymentMethod: paymentMethod || p.paymentMethod };
      if (referenceChanged && reference) next.reference = reference;
      else if (referenceChanged) delete next.reference;
      if (accountChanged && receivedInto) next.receivedInto = receivedInto;
      else if (accountChanged) delete next.receivedInto;
      return next;
    }));
    try {
      const updateData: Record<string, unknown> = { amount, service_claim: serviceClaim, date };
      if (paymentMethod) updateData.payment_method = paymentMethod;
      if (referenceChanged) updateData.reference = reference || null;
      if (accountChanged) updateData.received_into = receivedInto || null;
      const { data, error } = await supabase.from('payments').update(updateData).eq('id', paymentId).select(PAYMENT_COLUMNS).single();
      if (error) throw error;
      updateDriverPayments(driverId, payments => payments.map(p => (p.id === paymentId ? paymentFromRow(data) : p)));
    } catch (err: any) {
      const sameReference = err?.code === '23505' && /payments_reference_once/.test(err?.message ?? '');
      setNotice({ type: 'error', text: sameReference ? `Payment not updated: reference ${reference} is already on another payment of this driver.` : `Payment not updated: ${err.message}` });
      await fetchDriversAndPayments(true);
    }
  };

  /** Records the deposit/downpayment received at signing (typed only in Add / Edit Driver); reports (but does not throw) a failure. */
  const recordUpfront = async (driverId: string, upfront: UpfrontReceived | undefined, note: string, saved: string) => {
    const entries = [
      ...(upfront?.downpayment ? [{ kind: 'DOWNPAYMENT' as const, amount: upfront.downpayment }] : []),
      ...(upfront?.deposit ? [{ kind: 'DEPOSIT' as const, amount: upfront.deposit }] : []),
    ];
    try {
      for (const entry of entries) {
        await addDeposit({ driver_id: driverId, kind: entry.kind, entry: 'RECEIVED', entry_date: upfront!.date, amount: entry.amount, note });
      }
    } catch (err: any) {
      setNotice({ type: 'error', text: `${saved}, but the deposit/downpayment was not recorded: ${err.message}. Open Edit Driver and save it again.` });
    }
  };

  const handleCreateDriver = async (newDriver: Driver, upfront?: UpfrontReceived) => {
    let driverId: string;
    try {
      const dbDriver = { ...toDriverRow(newDriver), is_delisted: false, tags: newDriver.tags || [] };
      const { data, error } = await supabase.from('drivers').insert(dbDriver).select('id').single();
      if (error) throw error;
      driverId = (data as { id: string }).id;
    } catch (err: any) {
      setNotice({ type: 'error', text: `Driver not created: ${err.message}` });
      throw err; // keeps the form open with the details still filled in
    }
    // The money received at signing is recorded with the driver; the driver stays created even if this fails
    await recordUpfront(driverId, upfront, 'Recorded with Add Driver', 'Driver created');
    await fetchDriversAndPayments(true);
  };

  const handleUpdateDriver = async (updatedDriver: Driver, upfront?: UpfrontReceived) => {
    try {
      const dbUpdate = toDriverRow(updatedDriver);
      const { error } = await supabase.from('drivers').update(dbUpdate).eq('id', updatedDriver.id);
      if (error) throw error;
      await recordUpfront(updatedDriver.id, upfront, 'Recorded with Edit Driver', 'Driver saved');
      await fetchDriversAndPayments(true);
    } catch (err: any) {
      setNotice({ type: 'error', text: `Driver not saved: ${err.message}` });
      throw err; // keeps the form open with the details still filled in
    }
  };

  const handleDelistDriver = async (driverId: string) => {
    const today = kualaLumpurToday();
    try {
      const { error } = await supabase.from('drivers').update({ is_delisted: true, delist_date: today }).eq('id', driverId);
      if (error) throw error;
      await fetchDriversAndPayments(true);
    } catch (err: any) {
      setNotice({ type: 'error', text: `Driver not delisted: ${err.message}` });
    }
  };

  const handleDeleteDriver = async (driverId: string) => {
    try {
      const { error: paymentError } = await supabase.from('payments').delete().eq('driver_id', driverId);
      if (paymentError) throw paymentError;
      const { data: deleted, error: driverError } = await supabase.from('drivers').delete().eq('id', driverId).select('id');
      if (driverError) throw driverError;
      if (!deleted?.length) throw new Error('only an admin can delete a driver');
      await fetchDriversAndPayments(true);
      setNotice({ type: 'success', text: 'Driver and their payment records deleted.' });
    } catch (err: any) {
      setNotice({ type: 'error', text: `Driver not deleted: ${err.message}` });
    }
  };

  // The page a signed-in person sees at this address ("/" opens the saved tab; Finance is for admins)
  const adminRoute = useMemo(() => resolveAdminRoute(parseAdminPath(path), userRole === 'admin', storedViews()), [path, userRole]);
  useEffect(() => {
    if (currentView === 'ADMIN' && userRole) navigate(buildAdminPath(adminRoute), { replace: true });
    // The driver's phone page stays on "/"
    if (currentView === 'DRIVER') navigate('/', { replace: true });
  }, [adminRoute, currentView, userRole, navigate]);

  // --- Rendering ---

  if (loading || isAuthChecking || (currentView === 'ADMIN' && !dataLoaded && !error)) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center flex-col relative overflow-hidden">
        {/* Splash Screen Background */}
        <div className="absolute inset-0 bg-gradient-to-br from-blue-600 to-blue-800 opacity-10"></div>
        
        <div className="relative z-10 flex flex-col items-center">
            <div className="w-24 h-24 mb-6 animate-bounce">
                <img src="/logo.svg" alt="ECA Group Logo" className="w-full h-full drop-shadow-xl" />
            </div>
            
            <h1 className="text-2xl font-bold text-gray-800 tracking-widest mb-2">ECA GROUP</h1>
            <div className="flex items-center gap-3">
                <div className="w-2 h-2 bg-blue-600 rounded-full animate-ping"></div>
                <p className="text-blue-600 font-medium text-sm tracking-wide">Secure Connection...</p>
            </div>
        </div>
      </div>
    );
  }

  if (error) {
     const isTableMissing = error.toLowerCase().includes('could not find the table') || 
                           (error.toLowerCase().includes('relation') && error.toLowerCase().includes('does not exist'));

    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center p-4">
        <div className="bg-white p-8 rounded-xl shadow-lg max-w-lg text-center">
            <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <Database className="w-8 h-8 text-red-600" />
            </div>
            <h2 className="text-xl font-bold text-gray-900 mb-2">Can't load the rental data</h2>
            <div className="text-xs font-mono bg-gray-50 p-3 rounded border border-gray-200 text-red-600 mb-6 break-words">
              {error}
            </div>

            {isTableMissing ? (
               <div className="text-left text-sm bg-yellow-50 p-4 rounded-lg border border-yellow-200 mb-6 text-yellow-900">
                  <strong className="flex items-center gap-2 mb-2">
                    <UploadCloud className="w-5 h-5" aria-hidden="true" /> The database isn't set up as expected
                  </strong>
                  <p>The app reached the database, but a table it needs is missing. Please contact the administrator and pass on the message above.</p>
               </div>
            ) : (
               <div className="text-left text-sm bg-blue-50 p-4 rounded-lg border border-blue-100 mb-6 text-blue-900">
                   <p>Check your internet connection, then try again. If it keeps failing, contact the administrator and pass on the message above.</p>
               </div>
            )}

            <button onClick={() => void fetchDriversAndPayments()} className="w-full bg-blue-600 text-white py-3 rounded-lg font-medium hover:bg-blue-700 transition-colors flex items-center justify-center gap-2">
                <RefreshCw className="w-4 h-4" /> Retry Connection
            </button>
        </div>
      </div>
    );
  }

  if (currentView === 'LOGIN') {
    return <LoginView onLoginDriver={handleDriverLogin} onLoginAdmin={handleAdminLogin} lang={portalLang} onLangChange={changePortalLang} />;
  }

  if (currentView === 'DRIVER' && portal) {
    return (
      <DriverDashboard
        driver={portal.driver}
        agreement={portal.agreement}
        lang={portalLang}
        onLangChange={changePortalLang}
        loadedAt={portal.loadedAt}
        onRefresh={handleDriverRefresh}
        onLogout={handleLogout}
      />
    );
  }

  if (currentView === 'ADMIN' && adminRoute.kind === 'collections') {
    return <CollectionsDataPage drivers={drivers} userRole={userRole || 'staff'} />;
  }

  if (currentView === 'ADMIN' && adminRoute.kind === 'worklist') {
    return <WorklistPage drivers={drivers} onNavigate={navigate} />;
  }

  if (currentView === 'ADMIN') {
    return (
      <>
        <AdminDashboard
          drivers={drivers}
          userRole={userRole || 'staff'} // Default to staff safety if null
          onUpdatePayment={handleUpdatePayment}
          onEditPayment={handleEditPayment}
          onCreateDriver={handleCreateDriver}
          onUpdateDriver={handleUpdateDriver}
          onDelistDriver={handleDelistDriver}
          onDeleteDriver={handleDeleteDriver}
          onLogout={handleLogout}
          route={adminRoute}
          onNavigate={navigate}
        />
        <Notice notice={notice} onDismiss={dismissNotice} />
      </>
    );
  }

  return <div>Something went wrong.</div>;
};

export default App;
