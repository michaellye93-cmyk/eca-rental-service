import { useCallback, useEffect, useRef, useState } from 'react';
import { loadBankIn, loadPlans, loadPromises, loadRecentContacts, type BankIn } from '../services/collectionsApi';
import { reloadDue, type CatchUpPlan, type ContactSummary, type PaymentPromise } from '../services/collections';

/** How far back the contact log is read: enough for the last ask and each driver's last 10 entries. */
export const CONTACT_DAYS = 45;

export interface CollectionsExtras {
  /** False until the first load has finished. */
  loaded: boolean;
  /** Each is null when its table is not available yet (the database update has not been run) or could not be read. */
  bankIn: BankIn | null;
  promises: PaymentPromise[] | null;
  plans: CatchUpPlan[] | null;
  /**
   * Contacts logged in the last 45 days, newest first, without their message text (a driver's messages are read only
   * when their contact log is open).
   */
  contacts: ContactSummary[] | null;
  /** Reloads now (after logging or removing something). */
  reload: () => Promise<void>;
}

/**
 * The bank-in lines, promises, catch-up plans and recent contact log, loaded on sign-in and again when this tab comes
 * back into view, at most once a minute (as the driver list does).
 */
export function useCollectionsExtras(): CollectionsExtras {
  const [state, setState] = useState<Omit<CollectionsExtras, 'reload'>>({ loaded: false, bankIn: null, promises: null, plans: null, contacts: null });
  const lastLoad = useRef<number | null>(null);
  const reload = useCallback(async () => {
    lastLoad.current = Date.now();
    const since = new Date(Date.now() - CONTACT_DAYS * 86_400_000).toISOString();
    const [bankIn, promises, plans, contacts] = await Promise.allSettled([loadBankIn(), loadPromises(), loadPlans(), loadRecentContacts(since)]);
    setState({
      loaded: true,
      bankIn: bankIn.status === 'fulfilled' ? bankIn.value : null,
      promises: promises.status === 'fulfilled' ? promises.value : null,
      plans: plans.status === 'fulfilled' ? plans.value : null,
      contacts: contacts.status === 'fulfilled' ? contacts.value : null,
    });
  }, []);
  useEffect(() => {
    void reload();
    const whenVisible = () => {
      if (document.visibilityState === 'visible' && reloadDue(lastLoad.current, Date.now())) void reload();
    };
    document.addEventListener('visibilitychange', whenVisible);
    return () => document.removeEventListener('visibilitychange', whenVisible);
  }, [reload]);
  return { ...state, reload };
}
