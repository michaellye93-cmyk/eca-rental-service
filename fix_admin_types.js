import fs from 'fs';
let content = fs.readFileSync('./components/AdminDashboard.tsx', 'utf8');

// Replace in props type
content = content.replace(
  "paymentMethod?: 'BANK TRANSFER' | 'CASH DEPOSIT') => void;",
  "paymentMethod?: 'BANK TRANSFER' | 'CASH DEPOSIT' | 'CLAIM') => void;"
);
content = content.replace(
  "paymentMethod?: 'BANK TRANSFER' | 'CASH DEPOSIT') => void;",
  "paymentMethod?: 'BANK TRANSFER' | 'CASH DEPOSIT' | 'CLAIM') => void;"
);

// Replace in state
content = content.replace(
  "const [paymentMethod, setPaymentMethod] = useState<'BANK TRANSFER' | 'CASH DEPOSIT' | null>(null);",
  "const [paymentMethod, setPaymentMethod] = useState<'BANK TRANSFER' | 'CASH DEPOSIT' | 'CLAIM' | null>(null);"
);

// Replace in handleEditPayment state
content = content.replace(
  "const [editPaymentMethod, setEditPaymentMethod] = useState<'BANK TRANSFER' | 'CASH DEPOSIT'>('BANK TRANSFER');",
  "const [editPaymentMethod, setEditPaymentMethod] = useState<'BANK TRANSFER' | 'CASH DEPOSIT' | 'CLAIM'>('BANK TRANSFER');"
);

fs.writeFileSync('./components/AdminDashboard.tsx', content);
