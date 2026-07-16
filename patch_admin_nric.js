import fs from 'fs';
let code = fs.readFileSync('./components/AdminDashboard.tsx', 'utf8');

const formatNricFunc = `  const formatNric = (value: string) => {
    const cleaned = value.replace(/\\D/g, '');
    const truncated = cleaned.slice(0, 12);
    if (truncated.length > 8) {
        return \`\${truncated.slice(0, 6)}-\${truncated.slice(6, 8)}-\${truncated.slice(8)}\`;
    } else if (truncated.length > 6) {
        return \`\${truncated.slice(0, 6)}-\${truncated.slice(6)}\`;
    }
    return truncated;
  };`;

// Let's see where to inject formatNric in AdminDashboard.tsx
