// Mock GMT+8
process.env.TZ = 'Asia/Kuala_Lumpur';

const contractStartDate = "2026-06-29";
const startDate = new Date(contractStartDate + 'T00:00:00'); // 2026-06-29 00:00:00 MYT
console.log("StartDate: ", startDate, startDate.toISOString()); // 2026-06-28T16:00:00.000Z

for (let i = 0; i < 4; i++) {
    const invoiceDate = new Date(startDate);
    invoiceDate.setDate(startDate.getDate() + (i * 7));
    const dueDateISO = invoiceDate.toISOString().split('T')[0];
    
    const y = invoiceDate.getFullYear();
    const m = String(invoiceDate.getMonth() + 1).padStart(2, '0');
    const d = String(invoiceDate.getDate()).padStart(2, '0');
    const dueDateLocal = `${y}-${m}-${d}`;
    
    console.log(`i=${i}, ISO: ${dueDateISO}, Local: ${dueDateLocal}`);
}
