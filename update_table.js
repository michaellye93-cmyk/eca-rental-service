import fs from 'fs';
let content = fs.readFileSync('./components/AdminDashboard.tsx', 'utf8');

content = content.replace(
  '<th className="px-6 py-3">Email Address</th>',
  '<th className="px-6 py-3">Email Address</th>\n                                <th className="px-6 py-3">Address</th>'
);

content = content.replace(
  '<td className="px-6 py-4 text-gray-600 truncate max-w-[150px]" title={driver.email || \'\'}>{driver.email || \'-\'}</td>',
  '<td className="px-6 py-4 text-gray-600 truncate max-w-[150px]" title={driver.email || \'\'}>{driver.email || \'-\'}</td>\n                                        <td className="px-6 py-4 text-gray-600 truncate max-w-[200px]" title={driver.address || \'\'}>{driver.address || \'-\'}</td>'
);

content = content.replace(
  '<td colSpan={6} className="px-6 py-8 text-center text-gray-500">No active drivers found.</td>',
  '<td colSpan={7} className="px-6 py-8 text-center text-gray-500">No active drivers found.</td>'
);

fs.writeFileSync('./components/AdminDashboard.tsx', content);
