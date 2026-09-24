import React, { useState, useEffect, useCallback, useRef } from 'react';
import LoginView from './components/LoginView';
import DriverDashboard from './components/DriverDashboard';
import AdminDashboard from './components/AdminDashboard';
import { Driver } from './types';
import { calculateMomentum, parseDate, generateDriverInvoices, kualaLumpurToday, fromDriverRow, toDriverRow } from './utils'; // Import frontend metric calculation
import { supabase } from './supabaseClient';
import { Database, UploadCloud, RefreshCw } from 'lucide-react';
import { Session } from '@supabase/supabase-js';
import { signInWithAccessId } from './services/accessIdAuth';
import Notice, { type NoticeMessage } from './components/Notice';

const App: React.FC = () => {
  const [drivers, setDrivers] = useState<Driver[]>([]);
    const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  const [currentView, setCurrentView] = useState<'LOGIN' | 'DRIVER' | 'ADMIN'>('LOGIN');
  const [activeDriverId, setActiveDriverId] = useState<string | null>(null);

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

  useEffect(() => {
    currentViewRef.current = currentView;
  }, [currentView]);

  // --- Data Fetching ---
  const fetchDriversAndPayments = async (silent: boolean = false) => {
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
        let allDrivers: any[] = [];
        let dFrom = 0;
        while (true) {
            const { data, error } = await supabase
                .from('drivers')
                .select('*')
                .order('created_at', { ascending: false })
                .range(dFrom, dFrom + 999);
            if (error) throw error;
            if (data) allDrivers.push(...data);
            if (!data || data.length < 1000) break;
            dFrom += 1000;
        }
        const driversData = allDrivers;

        let allPayments: any[] = [];
        let fromIdx = 0;
        const pageLimit = 1000;
        while (true) {
            const { data, error } = await supabase
                .from('payments')
                .select('*')
                .order('date', { ascending: false })
                .range(fromIdx, fromIdx + pageLimit - 1);
            if (error) throw error;
            if (data) allPayments.push(...data);
            if (!data || data.length < pageLimit) break;
            fromIdx += pageLimit;
        }
        const paymentsData = allPayments;
        
        const formattedDrivers: Driver[] = (driversData || []).map((d: any) => {
            const myPayments = (paymentsData || [])
            .filter((p: any) => p.driver_id === d.id)
            .map((p: any) => ({
                id: p.id,
                date: p.date,
                amount: p.amount,
                serviceClaim: p.service_claim || 0,
                paymentMethod: p.payment_method || 'BANK TRANSFER'
            }))
            .sort((a: any, b: any) => parseDate(b.date).getTime() - parseDate(a.date).getTime());

            const totalPaid = myPayments.reduce((sum: number, p: any) => sum + p.amount + (p.serviceClaim || 0), 0);

            const profile = fromDriverRow(d);
            // Payment timing trend, calculated locally
            const momentum = calculateMomentum({ ...profile, totalAmountPaid: totalPaid, paymentHistory: myPayments });

            return {
            ...profile,
            totalAmountPaid: totalPaid,
            paymentHistory: myPayments,
            avgDaysLate: momentum.avgLateness,
            lastDaysLate: momentum.lastLateness,
            performanceVelocity: momentum.velocity
            };
        });

        return { formattedDrivers };

      };

      // Race the fetch against the timeout
      const result = (await Promise.race([fetchData(), timeoutPromise])) as { formattedDrivers: Driver[] };
      setDrivers(result.formattedDrivers);
    } catch (err: any) {
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
        setSession(null);
        setUserRole(null);
        setCurrentView('LOGIN');
        setIsAuthChecking(false);
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

  useEffect(() => {
    fetchDriversAndPayments();
  }, []);

  // --- Login Handlers ---

  /** Opens the driver's own dashboard; returns false when no driver has this NRIC (the login card says so). */
  const handleDriverLogin = (nric: string): boolean => {
    const cleanedLoginNric = nric.replace(/\D/g, '');
    const driver = drivers.find(d => (d.nric || '').replace(/\D/g, '') === cleanedLoginNric);
    if (!driver) return false;
    setActiveDriverId(driver.id);
    setCurrentView('DRIVER');
    return true;
  };

  const handleAdminLogin = async (accessId: string) => {
    await signInWithAccessId(accessId);
  };

  const handleLogout = async () => {
    if (currentView === 'ADMIN') {
      await supabase.auth.signOut();
    }
    setCurrentView('LOGIN');
    setActiveDriverId(null);
    setUserRole(null);
    setNotice(null);
  };

  // --- CRUD Operations (Passed to AdminDashboard) ---
  
  const syncDriverInvoicesToDb = async (driver: Driver) => {
    
    const invoices = generateDriverInvoices(driver);
    const payload = invoices.map(inv => ({
      id: inv.id,
      driver_id: inv.driverId,
      cycle_index: inv.cycleIndex,
      due_date: inv.dueDate,
      amount: inv.amount,
      amount_paid: inv.amountPaid,
      remaining_balance: inv.remainingBalance,
      status: inv.status
    }));
    
    // Chunk upsert
    for (let i=0; i<payload.length; i+=100) {
      await supabase.from('invoices').upsert(payload.slice(i, i+100), { onConflict: 'id' });
    }
  };

  const handleUpdatePayment = async (driverId: string, amount: number, date: string, serviceClaim: number = 0, paymentMethod: 'BANK TRANSFER' | 'CASH DEPOSIT' | 'CLAIM' = 'BANK TRANSFER') => {
    try {
      setDrivers(prev => prev.map(d => {
        if (d.id === driverId) {
          const newTx = { id: 'temp-' + Date.now(), amount, serviceClaim, date, paymentMethod };
          return {
             ...d,
             totalAmountPaid: d.totalAmountPaid + amount + serviceClaim,
             paymentHistory: [newTx, ...d.paymentHistory]
          };
        }
        return d;
      }));

      const { error } = await supabase.from('payments').insert({ 
        driver_id: driverId, 
        amount, 
        service_claim: serviceClaim, 
        date,
        payment_method: paymentMethod
      });
      if (error) throw error;
      await fetchDriversAndPayments(true);
      const updatedDriver = drivers.find(d => d.id === driverId);
      if (updatedDriver) {
         // Re-calculate based on new payment
         const newTx = { id: 'temp-' + Date.now(), amount, serviceClaim, date, paymentMethod };
         const syncDriver = {
             ...updatedDriver,
             totalAmountPaid: updatedDriver.totalAmountPaid + amount + serviceClaim,
             paymentHistory: [newTx, ...updatedDriver.paymentHistory]
         };
         await syncDriverInvoicesToDb(syncDriver);
      }
    } catch (err: any) {
      setNotice({ type: 'error', text: `Payment not saved: ${err.message}` });
      await fetchDriversAndPayments(true);
    }
  };

  const handleEditPayment = async (paymentId: string, amount: number, serviceClaim: number, date: string, paymentMethod?: 'BANK TRANSFER' | 'CASH DEPOSIT' | 'CLAIM') => {
    try {
      setDrivers(prev => prev.map(d => {
        const hasTx = d.paymentHistory.some(p => p.id === paymentId);
        if (hasTx) {
          const updatedHistory = d.paymentHistory.map(p => {
            if (p.id === paymentId) {
              return { ...p, amount, serviceClaim, date, paymentMethod: paymentMethod || p.paymentMethod };
            }
            return p;
          });
          const totalPaid = updatedHistory.reduce((sum, p) => sum + p.amount + (p.serviceClaim || 0), 0);
          return {
            ...d,
            paymentHistory: updatedHistory,
            totalAmountPaid: totalPaid
          };
        }
        return d;
      }));

      const updateData: any = { amount, service_claim: serviceClaim, date };
      if (paymentMethod) {
        updateData.payment_method = paymentMethod;
      }

      const { error } = await supabase
        .from('payments')
        .update(updateData)
        .eq('id', paymentId);
      if (error) throw error;
      await fetchDriversAndPayments(true);
    } catch (err: any) {
      setNotice({ type: 'error', text: `Payment not updated: ${err.message}` });
      await fetchDriversAndPayments(true);
    }
  };

  const handleCreateDriver = async (newDriver: Driver) => {
    try {
      const dbDriver = { ...toDriverRow(newDriver), is_delisted: false, tags: newDriver.tags || [] };
      const { error } = await supabase.from('drivers').insert(dbDriver);
      if (error) throw error;
      await fetchDriversAndPayments(true);
    } catch (err: any) {
      setNotice({ type: 'error', text: `Driver not created: ${err.message}` });
      throw err; // keeps the form open with the details still filled in
    }
  };

  const handleUpdateDriver = async (updatedDriver: Driver) => {
    try {
      const dbUpdate = toDriverRow(updatedDriver);
      const { error } = await supabase.from('drivers').update(dbUpdate).eq('id', updatedDriver.id);
      if (error) throw error;
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
      const { error: driverError } = await supabase.from('drivers').delete().eq('id', driverId);
      if (driverError) throw driverError;
      await fetchDriversAndPayments(true);
      setNotice({ type: 'success', text: 'Driver and their payment records deleted.' });
    } catch (err: any) {
      setNotice({ type: 'error', text: `Driver not deleted: ${err.message}` });
    }
  };

  // --- Rendering ---

  if (loading || isAuthChecking) {
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
    return <LoginView onLoginDriver={handleDriverLogin} onLoginAdmin={handleAdminLogin} />;
  }

  if (currentView === 'DRIVER' && activeDriverId) {
    const driver = drivers.find(d => d.id === activeDriverId);
    if (!driver) return <LoginView onLoginDriver={handleDriverLogin} onLoginAdmin={handleAdminLogin} />;
    return <DriverDashboard driver={driver} onLogout={handleLogout} />;
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
          onRefresh={() => fetchDriversAndPayments(true)}
        />
        <Notice notice={notice} onDismiss={dismissNotice} />
      </>
    );
  }

  return <div>Something went wrong.</div>;
};

export default App;
