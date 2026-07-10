import fs from 'fs';
let content = fs.readFileSync('./components/BankReconciliation.tsx', 'utf8');

// Move selectedMonth definition up
content = content.replace(
  "  const [selectedMonth, setSelectedMonth] = useState<string>(''); // YYYY-MM",
  ""
);

content = content.replace(
  "const [errorMsg, setErrorMsg] = useState<string | null>(null);",
  "const [errorMsg, setErrorMsg] = useState<string | null>(null);\n  const [selectedMonth, setSelectedMonth] = useState<string>(''); // YYYY-MM"
);

fs.writeFileSync('./components/BankReconciliation.tsx', content);
