import fs from 'fs';
let code = fs.readFileSync('./components/AdminDashboard.tsx', 'utf8');

const target = `onChange={e => setFormData({...formData, nric: e.target.value})}`;

const replace = `onChange={e => {
                                            const val = e.target.value;
                                            const cleaned = val.replace(/\\D/g, '');
                                            const truncated = cleaned.slice(0, 12);
                                            let formatted = truncated;
                                            if (truncated.length > 8) {
                                                formatted = \`\${truncated.slice(0, 6)}-\${truncated.slice(6, 8)}-\${truncated.slice(8)}\`;
                                            } else if (truncated.length > 6) {
                                                formatted = \`\${truncated.slice(0, 6)}-\${truncated.slice(6)}\`;
                                            }
                                            // Keep original value if user is deleting hyphens manually, but formatNric is safer to just apply on input
                                            setFormData({...formData, nric: formatted});
                                        }}`;

code = code.replace(target, replace);
fs.writeFileSync('./components/AdminDashboard.tsx', code);
