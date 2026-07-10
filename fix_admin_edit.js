import fs from 'fs';
let content = fs.readFileSync('./components/AdminDashboard.tsx', 'utf8');

const targetEdit = `  const handleSaveEditTx = async (txId: string) => {
    const amountNum = parseFloat(editAmount);
    const serviceClaimNum = parseFloat(editServiceClaim) || 0;
    if (isNaN(amountNum) || amountNum < 0) {
      alert("Invalid payment amount.");
      return;
    }
    if (!editDate) {
      alert("Please specify a valid payment date.");
      return;
    }
    
    if (onEditPayment) {
      onEditPayment(txId, amountNum, serviceClaimNum, editDate, editPaymentMethod);
    }
    handleCancelEditTx();
  };`;

const replaceEdit = `  const handleSaveEditTx = async (txId: string) => {
    const amountNum = parseFloat(editAmount) || 0;
    const serviceClaimNum = parseFloat(editServiceClaim) || 0;
    if (isNaN(amountNum) || amountNum < 0) {
      alert("Invalid payment amount.");
      return;
    }
    if (!editDate) {
      alert("Please specify a valid payment date.");
      return;
    }
    
    let finalMethod = editPaymentMethod;
    if (!finalMethod) {
        if (amountNum === 0 && serviceClaimNum > 0) {
            finalMethod = 'CLAIM';
        } else {
            alert("Please select a payment method."); return;
        }
    }
    
    if (onEditPayment) {
      onEditPayment(txId, amountNum, serviceClaimNum, editDate, finalMethod);
    }
    handleCancelEditTx();
  };`;

content = content.replace(targetEdit, replaceEdit);
fs.writeFileSync('./components/AdminDashboard.tsx', content);
