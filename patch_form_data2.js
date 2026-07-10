import fs from 'fs';
let content = fs.readFileSync('./components/AdminDashboard.tsx', 'utf8');

const target = `                                    <input type="email" className="w-full border border-gray-300 rounded p-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none" value={formData.email} onChange={e => setFormData({...formData, email: e.target.value})} placeholder="Email (Optional)" />
                                </div>`;
const replacement = target + `
                                <div>
                                    <label className="block text-sm font-bold text-gray-700 mb-1">Address</label>
                                    <textarea className="w-full border border-gray-300 rounded p-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none" rows={2} value={formData.address} onChange={e => setFormData({...formData, address: e.target.value})} placeholder="Driver Address"></textarea>
                                </div>`;

content = content.replace(target, replacement);
fs.writeFileSync('./components/AdminDashboard.tsx', content);
