
import React, { useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { formatNric } from '../utils';
import { ConfirmDialog } from './Dialog';

interface LoginViewProps {
  /** Resolves false when no driver has this NRIC; rejects with a message when sign-in is unavailable. */
  onLoginDriver: (nric: string) => Promise<boolean>;
  onLoginAdmin: (accessId: string) => Promise<void>;
}

const LoginView: React.FC<LoginViewProps> = ({ onLoginDriver, onLoginAdmin }) => {
  const [nric, setNric] = useState('');
  
  // Admin Credentials State
  const [adminId, setAdminId] = useState('');
  const [error, setError] = useState('');
  const [isAdminLoggingIn, setIsAdminLoggingIn] = useState(false);
  const [isDriverLoggingIn, setIsDriverLoggingIn] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  // Drivers (on phones) see only their own sign-in; staff open theirs from a small link at the bottom.
  const [showStaff, setShowStaff] = useState(false);

  const handleDriverLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nric.trim()) {
      setError('Please enter your NRIC');
      return;
    }
    setError('');
    setIsDriverLoggingIn(true);
    try {
      if (!(await onLoginDriver(nric.trim()))) setError('Driver not found. Please check your NRIC.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Driver sign-in is not available right now. Please try again later.');
    } finally {
      setIsDriverLoggingIn(false);
    }
  };

  const handleAdminLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    const accessId = adminId.trim();
    if (!accessId) {
      setError('Enter your Access ID.');
      return;
    }

    setError('');
    setIsAdminLoggingIn(true);
    try {
      await onLoginAdmin(accessId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to sign in. Please try again.');
    } finally {
      setIsAdminLoggingIn(false);
    }
  };

  const handleNricChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    if (val.length < nric.length) {
        setNric(val);
        return;
    }
    setNric(formatNric(val));
    setError('');
  };

  return (
    <div className="min-h-screen bg-gray-100 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden">
        <div className="bg-blue-600 p-6 text-center">
          <div className="mx-auto bg-white rounded-lg flex flex-col items-center justify-center mb-6 shadow-xl p-6 w-48">
             <div className="w-20 h-20 mb-2">
                <img src="/logo.svg" alt="ECA Group Logo" className="w-full h-full" />
             </div>
             <div className="w-full h-0.5 bg-black mb-2"></div>
             <span className="text-black font-bold text-lg tracking-widest leading-none">ECA GROUP</span>
          </div>
          
          <h1 className="text-2xl font-bold text-white tracking-wide uppercase">ECA RENTAL SERVICE</h1>
          <p className="text-blue-100 text-sm mt-1">Driver Portal & Management</p>
        </div>

        <div className="p-8 space-y-8">
          {/* Driver Login */}
          <form onSubmit={handleDriverLogin}>
            <h2 className="text-lg font-semibold text-gray-800 mb-4 flex items-center gap-2">
              <span className="w-1 h-6 bg-blue-600 rounded-full"></span>
              Driver Login
            </h2>
            <div className="space-y-4">
              <div>
                <label htmlFor="nric" className="block text-sm font-medium text-gray-600 mb-1">NRIC Number</label>
                <input
                  id="nric"
                  name="nric"
                  type="text"
                  inputMode="numeric"
                  autoComplete="off"
                  placeholder="XXXXXX-XX-XXXX"
                  maxLength={14}
                  className="w-full px-4 py-3 rounded-lg border border-gray-300 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all placeholder:tracking-widest"
                  value={nric}
                  onChange={handleNricChange}
                />
              </div>
              <button
                type="submit"
                disabled={isDriverLoggingIn}
                className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white font-semibold py-3 rounded-lg transition-all active:scale-[0.98] shadow-lg shadow-blue-600/20"
              >
                {isDriverLoggingIn ? 'Checking…' : 'Check My Dashboard'}
              </button>
            </div>
          </form>

          {error && (
            <div className="bg-red-50 text-red-600 text-sm p-3 rounded-lg text-center">
              {error}
            </div>
          )}
          
          {showStaff ? (
            <div className="space-y-4 portal-reveal">
              {/* Admin Login */}
              <form onSubmit={handleAdminLogin} className="bg-gray-50 p-4 rounded-xl border border-gray-200">
                <h2 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-gray-500" />
                  Staff / Admin Access
                </h2>
                <div className="flex gap-2">
                  <input
                    id="adminId"
                    name="adminId"
                    type="text"
                    placeholder="Access ID"
                    className="flex-1 px-3 py-2 rounded-lg border border-gray-300 focus:ring-2 focus:ring-gray-500 focus:outline-none text-sm"
                    value={adminId}
                    onChange={(e) => {
                      setAdminId(e.target.value);
                      setError('');
                    }}
                  />
                  <button
                    type="submit"
                    disabled={isAdminLoggingIn}
                    className="bg-gray-800 hover:bg-gray-900 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors whitespace-nowrap"
                  >
                    {isAdminLoggingIn ? 'Logging in…' : 'Login'}
                  </button>
                </div>
              </form>
              <div className="text-center">
                <button
                  type="button"
                  onClick={() => setConfirmReset(true)}
                  className="text-xs text-gray-500 hover:text-red-500 underline transition-colors"
                >
                  Reset App
                </button>
              </div>
            </div>
          ) : (
            <div className="text-center">
              <button
                type="button"
                onClick={() => setShowStaff(true)}
                className="text-xs text-gray-500 hover:text-gray-700 underline transition-colors"
              >
                Staff sign-in
              </button>
            </div>
          )}
          {confirmReset && (
            // Emergency reset: clears this browser's saved session and settings, then reloads
            <ConfirmDialog
              title="Reset App"
              confirmLabel="Reset and reload"
              onCancel={() => setConfirmReset(false)}
              onConfirm={() => {
                localStorage.clear();
                sessionStorage.clear();
                window.location.reload();
              }}
            >
              <p>This clears everything this app has saved in this browser (sign-in, filters, tabs and any receipts uploaded here), then reloads the page.</p>
            </ConfirmDialog>
          )}
        </div>
      </div>
    </div>
  );
};

export default LoginView;
