
import React, { useState } from 'react';
import { ShieldCheck } from 'lucide-react';

interface LoginViewProps {
  onLoginDriver: (nric: string) => void;
  onLoginAdmin: (accessId: string) => void;
}

const LoginView: React.FC<LoginViewProps> = ({ onLoginDriver, onLoginAdmin }) => {
  const [nric, setNric] = useState('');
  
  // Admin Credentials State
  const [adminId, setAdminId] = useState('');
  const [error, setError] = useState('');

  const handleDriverLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (!nric.trim()) {
      setError('Please enter your NRIC');
      return;
    }
    onLoginDriver(nric.trim());
  };

  const handleAdminLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (!adminId.trim()) {
        setError('Please enter Access ID');
        return;
    }
    onLoginAdmin(adminId.trim());
  };

  const formatNric = (value: string) => {
    const cleaned = value.replace(/\D/g, '');
    const truncated = cleaned.slice(0, 12);
    if (truncated.length > 8) {
        return `${truncated.slice(0, 6)}-${truncated.slice(6, 8)}-${truncated.slice(8)}`;
    } else if (truncated.length > 6) {
        return `${truncated.slice(0, 6)}-${truncated.slice(6)}`;
    }
    return truncated;
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
                  placeholder="XXXXXX-XX-XXXX"
                  maxLength={14}
                  className="w-full px-4 py-3 rounded-lg border border-gray-300 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all placeholder:tracking-widest"
                  value={nric}
                  onChange={handleNricChange}
                />
              </div>
              <button
                type="submit"
                className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 rounded-lg transition-colors shadow-lg shadow-blue-600/20"
              >
                Check My Dashboard
              </button>
            </div>
          </form>

          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-gray-200"></div>
            </div>
            <div className="relative flex justify-center text-sm">
              <span className="px-2 bg-white text-gray-400">or Admin Access</span>
            </div>
          </div>

          {/* Admin Login - UPDATED: No Password Field */}
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
                className="bg-gray-800 hover:bg-gray-900 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors whitespace-nowrap"
              >
                Login
              </button>
            </div>
          </form>

          {error && (
            <div className="bg-red-50 text-red-600 text-sm p-3 rounded-lg text-center animate-pulse">
              {error}
            </div>
          )}
          
          <div className="text-center mt-8">
            <button 
                onClick={() => {
                    // Emergency Reset
                    if(window.confirm("This will clear all session data and reload the app. Continue?")) {
                        localStorage.clear();
                        sessionStorage.clear();
                        window.location.reload();
                    }
                }}
                className="text-xs text-gray-400 hover:text-red-500 underline transition-colors"
            >
                Reset App
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default LoginView;
