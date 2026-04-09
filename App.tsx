import React, { useState, useEffect } from 'react';
import LoginView from './components/LoginView';
import DriverDashboard from './components/DriverDashboard';
import AdminDashboard from './components/AdminDashboard';
import { Driver, PaymentTransaction, Car } from './types';
import { calculateMomentum } from './utils'; // Import frontend metric calculation
import { supabase } from './supabaseClient';
import { Database, UploadCloud, RefreshCw } from 'lucide-react';
import { Session } from '@supabase/supabase-js';

const App: React.FC = () => {
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [cars, setCars] = useState<Car[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  const [currentView, setCurrentView] = useState<'LOGIN' | 'DRIVER' | 'ADMIN'>('LOGIN');
  const [activeDriverId, setActiveDriverId] = useState<string | null>(null);

  // Auth State
  const [session, setSession] = useState<Session | null>(null);
  const [userRole, setUserRole] = useState<'admin' | 'staff' | null>(null);
  const [isAuthChecking, setIsAuthChecking] = useState(true);

  // --- Data Fetching ---
  const fetchDriversAndPayments = async () => {
    let isMounted = true;
    try {
      setLoading(true);
      setError(null);

      // Timeout Promise
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Connection timed out. Please check your network or API configuration.')), 15000)
      );

      // Actual Data Fetch
      const fetchData = async () => {
        // CHANGED: Fetch directly from 'drivers' table to ensure we get all new columns
        // The view 'driver_performance_monitor' might be stale regarding new schema changes
        const { data: driversData, error: driversError } = await supabase
            .from('drivers')
            .select('*')
            .order('created_at', { ascending: false });

        if (driversError) throw driversError;

        const { data: paymentsData, error: paymentsError } = await supabase
            .from('payments')
            .select('*');

        if (paymentsError) throw paymentsError;
        
        const { data: carsData, error: carsError } = await supabase
            .from('cars')
            .select('*');
        
        if (carsError) {
            console.warn('Cars table might not exist yet:', carsError);
        } else {
            setCars(carsData || []);
        }

        const formattedDrivers: Driver[] = (driversData || []).map((d: any) => {
            const myPayments = (paymentsData || [])
            .filter((p: any) => p.driver_id === d.id)
            .map((p: any) => ({
                id: p.id,
                date: p.date,
                amount: p.amount
            }))
            .sort((a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime());

            const totalPaid = myPayments.reduce((sum: number, p: any) => sum + p.amount, 0);

            // Calculate momentum metrics locally to replace SQL View logic
            const tempDriverForCalc = {
                contractStartDate: d.contract_start_date,
                rentalCycle: d.rental_cycle || 'WEEKLY',
                paymentHistory: myPayments
            } as Driver;
            
            const momentum = calculateMomentum(tempDriverForCalc);

            return {
            id: d.id,
            nric: d.nric,
            name: d.name,
            carPlate: d.car_plate,
            contractStartDate: d.contract_start_date,
            contractEndDate: d.contract_end_date, // Now reliably fetched from table
            category: d.category, // Now reliably fetched from table
            rentalCycle: d.rental_cycle || 'WEEKLY',
            contractDuration: d.contract_duration_weeks,
            rentalRate: d.rental_rate,
            isDelisted: d.is_delisted,
            delistDate: d.delist_date,
            tags: d.tags || [],
            totalAmountPaid: totalPaid,
            paymentHistory: myPayments,
            
            // Use frontend calculations instead of view columns
            avgDaysLate: momentum.avgLateness,
            lastDaysLate: momentum.lastLateness,
            performanceVelocity: momentum.velocity
            };
        });
        return formattedDrivers;
      };

      // Race the fetch against the timeout
      const result = await Promise.race([fetchData(), timeoutPromise]);
      
      if (isMounted) {
        setDrivers(result as Driver[]);
      }

    } catch (err: any) {
      console.error('Error fetching data:', err);
      if (isMounted) {
        setError(err.message || 'Failed to connect to database');
      }
    } finally {
        if (isMounted) {
            setLoading(false);
        }
    }
    return () => { isMounted = false; };
  };

  // --- Auth & Session Management ---
  useEffect(() => {
    // 1. Check active session on mount
    supabase.auth.getSession().then(({ data: { session }, error }) => {
      if (error) {
        console.warn("Session check error:", error);
        // If refresh token is invalid, force logout to clear stale state
        if (error.message && (error.message.includes("Refresh Token") || error.message.includes("refresh_token_not_found"))) {
           supabase.auth.signOut();
           setSession(null);
           setCurrentView('LOGIN');
        }
        setIsAuthChecking(false);
      } else {
        setSession(session);
        if (session) {
          fetchUserRole(session.user.id, session.user.email);
        } else {
          setIsAuthChecking(false);
        }
      }
    });

    // 2. Listen for auth changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT' || (event as string) === 'USER_DELETED') {
        setSession(null);
        setUserRole(null);
        if (currentView === 'ADMIN') {
          setCurrentView('LOGIN');
        }
        setIsAuthChecking(false);
        return;
      }

      if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
          setSession(session);
          if (session) {
            // FIX: If it's the hardcoded admin, we already optimistically set the state in handleAdminLogin.
            // Do NOT reset isAuthChecking to true, or it will cause a flicker (Admin -> Splash -> Admin).
            const isOptimisticAdmin = session.user.email === 'ecaadmin6727@eca.com';
            
            if (!isOptimisticAdmin) {
                // Only show splash screen for non-optimized users (like normal drivers or other staff)
                setIsAuthChecking(true);
            }
            
            fetchUserRole(session.user.id, session.user.email);
          }
      }
    });

    return () => subscription.unsubscribe();
  }, [currentView]); // Add currentView dependency to safely redirect

  const fetchUserRole = async (userId: string, email?: string) => {
    // 3. Admin Override Fix
    if (email === 'ecaadmin6727@eca.com') {
        setUserRole('admin');
        setCurrentView('ADMIN');
        setIsAuthChecking(false);
        return;
    }

    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', userId)
        .single();

      if (error) {
        console.error('Error fetching profile:', error);
        setUserRole('staff'); // Default to restricted if profile fetch fails but auth succeeded
        setCurrentView('ADMIN');
      } else if (data) {
        setUserRole(data.role as 'admin' | 'staff');
        setCurrentView('ADMIN'); // Auto-navigate to Admin Dashboard
      }
    } catch (e) {
      console.error('Profile fetch exception', e);
      setUserRole('staff');
    } finally {
      setIsAuthChecking(false);
    }
  };

  useEffect(() => {
    fetchDriversAndPayments();
  }, []);

  // --- Login Handlers ---

  const handleDriverLogin = (nric: string) => {
    const driver = drivers.find(d => d.nric === nric);
    if (driver) {
      setActiveDriverId(driver.id);
      setCurrentView('DRIVER');
    } else {
      alert('Driver not found. Please check your NRIC.');
    }
  };

  const handleAdminLogin = async (accessId: string) => {
    // Helper: If user enters just "ecaadmin6727", append @eca.com
    let email = accessId;
    if (!email.includes('@')) {
      email = `${email}@eca.com`;
    }

    // IMMEDIATE OVERRIDE: If it's the admin, set state BEFORE auth to prevent flicker
    if (email === 'ecaadmin6727@eca.com') {
        setUserRole('admin');
        setCurrentView('ADMIN');
        setIsAuthChecking(false);
    }

    // AUTHENTICATE with HARDCODED PASSWORD
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password: "123456", 
    });

    if (error) {
      alert(`Login failed: ${error.message}`);
      // Revert state if login actually failed
      if (email === 'ecaadmin6727@eca.com') {
          setUserRole(null);
          setCurrentView('LOGIN');
          setIsAuthChecking(false);
      }
    }
    // Success is handled by onAuthStateChange
  };

  const handleLogout = async () => {
    if (currentView === 'ADMIN') {
      await supabase.auth.signOut();
    }
    setCurrentView('LOGIN');
    setActiveDriverId(null);
    setUserRole(null);
  };

  // --- CRUD Operations (Passed to AdminDashboard) ---
  const handleUpdatePayment = async (driverId: string, amount: number, date: string) => {
    try {
      setDrivers(prev => prev.map(d => {
        if (d.id === driverId) {
          const newTx = { id: 'temp-' + Date.now(), amount, date };
          return {
             ...d,
             totalAmountPaid: d.totalAmountPaid + amount,
             paymentHistory: [newTx, ...d.paymentHistory]
          };
        }
        return d;
      }));

      const { error } = await supabase.from('payments').insert({ driver_id: driverId, amount, date });
      if (error) throw error;
      await fetchDriversAndPayments();
    } catch (err: any) {
      alert(`Error saving payment: ${err.message}`);
      fetchDriversAndPayments();
    }
  };

  const handleCreateDriver = async (newDriver: Driver) => {
    try {
      const dbDriver = {
        nric: newDriver.nric,
        name: newDriver.name,
        // contact_number removed
        car_plate: newDriver.carPlate,
        contract_start_date: newDriver.contractStartDate,
        contract_end_date: newDriver.contractEndDate || null,
        category: newDriver.category || 'SEWABELI',
        rental_cycle: newDriver.rentalCycle,
        contract_duration_weeks: newDriver.contractDuration,
        rental_rate: newDriver.rentalRate,
        is_delisted: false,
        tags: newDriver.tags || []
      };
      const { error } = await supabase.from('drivers').insert(dbDriver);
      if (error) throw error;
      await fetchDriversAndPayments();
    } catch (err: any) {
      alert(`Error creating driver: ${err.message}`);
    }
  };

  const handleUpdateDriver = async (updatedDriver: Driver) => {
    try {
       const dbUpdate = {
        nric: updatedDriver.nric,
        name: updatedDriver.name,
        // contact_number removed
        car_plate: updatedDriver.carPlate,
        contract_start_date: updatedDriver.contractStartDate,
        contract_end_date: updatedDriver.contractEndDate || null,
        category: updatedDriver.category || 'SEWABELI',
        rental_cycle: updatedDriver.rentalCycle,
        contract_duration_weeks: updatedDriver.contractDuration,
        rental_rate: updatedDriver.rentalRate,
        tags: updatedDriver.tags
      };
      const { error } = await supabase.from('drivers').update(dbUpdate).eq('id', updatedDriver.id);
      if (error) throw error;
      await fetchDriversAndPayments();
    } catch (err: any) {
      alert(`Error updating driver: ${err.message}`);
    }
  };

  const handleDelistDriver = async (driverId: string) => {
    const today = new Date().toISOString().split('T')[0];
    try {
      const { error } = await supabase.from('drivers').update({ is_delisted: true, delist_date: today }).eq('id', driverId);
      if (error) throw error;
      await fetchDriversAndPayments();
    } catch (err: any) {
      alert(`Error delisting driver: ${err.message}`);
    }
  };

  const handleCreateCar = async (newCar: Car) => {
    try {
      const { error } = await supabase.from('cars').insert(newCar);
      if (error) throw error;
      await fetchDriversAndPayments();
    } catch (err: any) {
      alert(`Error creating car: ${err.message}`);
    }
  };

  const handleUpdateCar = async (updatedCar: Car) => {
    try {
      const { error } = await supabase.from('cars').update(updatedCar).eq('id', updatedCar.id);
      if (error) throw error;
      await fetchDriversAndPayments();
    } catch (err: any) {
      alert(`Error updating car: ${err.message}`);
    }
  };

  const handleDeleteCar = async (carId: string) => {
    try {
      const { error } = await supabase.from('cars').delete().eq('id', carId);
      if (error) throw error;
      await fetchDriversAndPayments();
    } catch (err: any) {
      alert(`Error deleting car: ${err.message}`);
    }
  };

  const handleDeleteDriver = async (driverId: string) => {
    try {
      const { error: paymentError } = await supabase.from('payments').delete().eq('driver_id', driverId);
      if (paymentError) throw paymentError;
      const { error: driverError } = await supabase.from('drivers').delete().eq('id', driverId);
      if (driverError) throw driverError;
      await fetchDriversAndPayments();
      alert('Driver profile deleted.');
    } catch (err: any) {
      alert(`Error deleting driver: ${err.message}`);
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
            <h2 className="text-xl font-bold text-gray-900 mb-2">Database Connection Failed</h2>
            <div className="text-xs font-mono bg-gray-50 p-3 rounded border border-gray-200 text-red-500 mb-6 break-words">
              {error}
            </div>
            
            {isTableMissing ? (
               <div className="text-left text-sm bg-yellow-50 p-4 rounded-lg border border-yellow-200 mb-6 text-yellow-900">
                  <strong className="flex items-center gap-2 mb-2">
                    <UploadCloud className="w-5 h-5"/> Missing Database Tables
                  </strong> 
                  <p className="mb-3">
                    Your Supabase project is connected, but the required tables do not exist yet.
                  </p>
                  <div className="bg-white p-3 rounded border border-yellow-100 text-xs text-gray-700">
                    <strong>Action Required:</strong>
                    <ol className="list-decimal list-inside mt-1 space-y-1">
                      <li>Go to <a href="https://supabase.com/dashboard" target="_blank" rel="noreferrer" className="underline text-blue-600">Supabase Dashboard</a> &gt; SQL Editor.</li>
                      <li>Run the creation script.</li>
                    </ol>
                  </div>
               </div>
            ) : (
               <div className="text-left text-sm bg-blue-50 p-4 rounded-lg border border-blue-100 mb-6 text-blue-900">
                   <strong>Check Configuration:</strong> 
                   <p className="mt-1">Ensure your <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> are set correctly in the Settings menu.</p>
               </div>
            )}

            <button onClick={fetchDriversAndPayments} className="w-full bg-blue-600 text-white py-3 rounded-lg font-medium hover:bg-blue-700 transition-colors flex items-center justify-center gap-2">
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
      <AdminDashboard 
        drivers={drivers}
        cars={cars}
        userRole={userRole || 'staff'} // Default to staff safety if null
        onUpdatePayment={handleUpdatePayment}
        onCreateDriver={handleCreateDriver}
        onUpdateDriver={handleUpdateDriver}
        onDelistDriver={handleDelistDriver}
        onDeleteDriver={handleDeleteDriver}
        onCreateCar={handleCreateCar}
        onUpdateCar={handleUpdateCar}
        onDeleteCar={handleDeleteCar}
        onLogout={handleLogout}
        onRefresh={fetchDriversAndPayments}
      />
    );
  }

  return <div>Something went wrong.</div>;
};

export default App;
