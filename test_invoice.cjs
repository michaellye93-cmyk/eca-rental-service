const contractStartDate = "2026-06-29";
const startDate = new Date(contractStartDate + 'T00:00:00');
console.log("StartDate: ", startDate, startDate.toISOString());

for (let i = 0; i < 4; i++) {
    const invoiceDate = new Date(startDate);
    invoiceDate.setDate(startDate.getDate() + (i * 7));
    const dueDate = invoiceDate.toISOString().split('T')[0];
    console.log(`i=${i}, invoiceDate: ${invoiceDate.toISOString()}, dueDate: ${dueDate}`);
}
