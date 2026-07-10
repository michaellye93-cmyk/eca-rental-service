import fs from 'fs';
let content = fs.readFileSync('./components/AdminDashboard.tsx', 'utf8');

const targetHandleSubmit = `  const handleSubmitPayment = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedDriverForPayment) return;
    const amount = parseFloat(paymentAmount);
    const serviceClaim = parseFloat(serviceClaimAmount) || 0;
    if (isNaN(amount) || amount < 0) { alert("Invalid amount."); return; }
    if (!paymentDate) { alert("Select date."); return; }
    if (!paymentMethod) { alert("Please select either BANK TRANSFER or CASH DEPOSIT."); return; }
    onUpdatePayment(selectedDriverForPayment.id, amount, paymentDate, serviceClaim, paymentMethod);
    setIsPaymentModalOpen(false); setSelectedDriverForPayment(null); setPaymentAmount(''); setServiceClaimAmount('0'); setPaymentDate(''); setPaymentMethod(null);
  };`;

const replaceHandleSubmit = `  const handleSubmitPayment = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedDriverForPayment) return;
    const amount = parseFloat(paymentAmount) || 0;
    const serviceClaim = parseFloat(serviceClaimAmount) || 0;
    if (isNaN(amount) || amount < 0) { alert("Invalid amount."); return; }
    if (!paymentDate) { alert("Select date."); return; }
    
    let finalMethod = paymentMethod;
    if (!finalMethod) {
        if (amount === 0 && serviceClaim > 0) {
            finalMethod = 'CLAIM';
        } else {
            alert("Please select either BANK TRANSFER or CASH DEPOSIT."); return;
        }
    }
    
    onUpdatePayment(selectedDriverForPayment.id, amount, paymentDate, serviceClaim, finalMethod);
    setIsPaymentModalOpen(false); setSelectedDriverForPayment(null); setPaymentAmount(''); setServiceClaimAmount('0'); setPaymentDate(''); setPaymentMethod(null);
  };`;
  
content = content.replace(targetHandleSubmit, replaceHandleSubmit);
fs.writeFileSync('./components/AdminDashboard.tsx', content);
