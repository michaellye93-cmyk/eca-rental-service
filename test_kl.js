const klStr = new Date().toLocaleString("en-US", { timeZone: "Asia/Kuala_Lumpur" });
console.log(klStr);
const klDate = new Date(klStr);
console.log(klDate);
console.log(klDate.getFullYear(), klDate.getMonth(), klDate.getDate(), klDate.getHours());
