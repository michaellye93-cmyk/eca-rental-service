const fs = require('fs');
let code = fs.readFileSync('components/BankReconciliation.tsx', 'utf-8');

const newMock = `  const processMockReconciliation = async () => {
    // Local mock for preview in AI Studio: Synergized with System Data
    return new Promise<ReconciliationResult>((resolve) => {
      setTimeout(() => {
        const paired: ReconcileTransaction[] = [];
        const unsolved: any[] = [];
        
        drivers.forEach(driver => {
           if (driver.isDelisted) return;
           driver.paymentHistory.forEach(tx => {
               const isCashDeposit = tx.paymentMethod === 'CASH DEPOSIT';
               
               paired.push({
                   status: 'MATCHED',
                   trans_date: tx.date,
                   amount: tx.amount,
                   sender_name: isCashDeposit ? 'CASH DEPOSIT MACH' : driver.name.toUpperCase(),
                   reference: isCashDeposit ? 'CASH DEPOSIT' : 'TRF ' + driver.carPlate,
                   plate_number: driver.carPlate,
                   driver_id: driver.id
               });
           });
        });

        const unpaired: ReconcileTransaction[] = [
           { status: 'UNMATCHED', trans_date: new Date().toISOString().split('T')[0], amount: 100.00, sender_name: 'UNKNOWN TRANSFER', reference: 'NO REF', plate_number: 'UNKNOWN' }
        ];

        resolve({
          paired_transactions: paired,
          unpaired_transactions: unpaired,
          unsolved_system_transactions: unsolved
        });
      }, 2000);
    });
  };`;

code = code.replace(/const processMockReconciliation = async \(\) => \{[\s\S]*?\}\;\n\n  const handleUpload/, newMock + '\n\n  const handleUpload');
fs.writeFileSync('components/BankReconciliation.tsx', code);
console.log("Patched");
