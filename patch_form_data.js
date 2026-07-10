import fs from 'fs';
let s = fs.readFileSync('./components/AdminDashboard.tsx', 'utf8');

s = s.replace(
  "email: '',\n    nric: '',",
  "email: '',\n    address: '',\n    nric: '',"
);

s = s.replace(
  "email: driver.email || '',\n      nric: driver.nric,",
  "email: driver.email || '',\n      address: driver.address || '',\n      nric: driver.nric,"
);

s = s.replace(
  /<input type="email" className="w-full([^>]+)value=\{formData.email\}([^>]+)placeholder="Email \(Optional\)" \/>\s*<\/div>/,
  '<input type="email" className="w-full$1value={formData.email}$2placeholder="Email (Optional)" />\n                                </div>\n                                <div>\n                                    <label className="block text-sm font-bold text-gray-700 mb-1">Address</label>\n                                    <textarea className="w-full border border-gray-300 rounded p-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none" rows={2} value={formData.address} onChange={e => setFormData({...formData, address: e.target.value})} placeholder="Driver Address"></textarea>\n                                </div>'
);

fs.writeFileSync('./components/AdminDashboard.tsx', s);
