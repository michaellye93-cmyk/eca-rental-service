const klString = new Date().toLocaleString("en-US", { timeZone: "Asia/Kuala_Lumpur" }); // "7/19/2026, 3:55:00 PM"
const today = new Date(klString);
today.setHours(0, 0, 0, 0);

const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
console.log("todayStr:", todayStr);
