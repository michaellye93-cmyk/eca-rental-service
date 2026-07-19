const fs = require('fs');
let code = fs.readFileSync('./components/AnalyticsView.tsx', 'utf8');

const targetMemo = `const allWeeklyFinancials = useMemo(() => {
    const weeks: any[] = [];
    const todayRef = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Kuala_Lumpur" }));
    todayRef.setHours(0,0,0,0);
    
    // Setup 12-Week Buckets
    const currentDay = todayRef.getDay(); 
    const diff = todayRef.getDate() - currentDay + (currentDay === 0 ? -6 : 1);
    const currentMonday = new Date(todayRef);
    currentMonday.setDate(diff);

    for (let i = 0; i < 12; i++) {
        const startOfWeek = new Date(currentMonday);
        startOfWeek.setDate(currentMonday.getDate() - (i * 7));
        startOfWeek.setHours(0,0,0,0);
        const endOfWeek = new Date(startOfWeek);
        endOfWeek.setDate(startOfWeek.getDate() + 6);
        endOfWeek.setHours(23,59,59,999);`;

const replacementMemo = `const allWeeklyFinancials = useMemo(() => {
    const weeks: any[] = [];
    
    const klString = new Date().toLocaleString("en-US", { timeZone: "Asia/Kuala_Lumpur" });
    const klDateLocal = new Date(klString);
    const todayUTC = new Date(Date.UTC(klDateLocal.getFullYear(), klDateLocal.getMonth(), klDateLocal.getDate()));
    
    // Setup 12-Week Buckets using UTC
    const currentDay = todayUTC.getUTCDay(); 
    const diff = todayUTC.getUTCDate() - currentDay + (currentDay === 0 ? -6 : 1);
    const currentMonday = new Date(todayUTC);
    currentMonday.setUTCDate(diff);

    for (let i = 0; i < 12; i++) {
        const startOfWeek = new Date(currentMonday);
        startOfWeek.setUTCDate(currentMonday.getUTCDate() - (i * 7));
        startOfWeek.setUTCHours(0,0,0,0);
        
        const endOfWeek = new Date(startOfWeek);
        endOfWeek.setUTCDate(startOfWeek.getUTCDate() + 6);
        endOfWeek.setUTCHours(23,59,59,999);`;

const startIndex = code.indexOf(targetMemo);
if (startIndex !== -1) {
    code = code.substring(0, startIndex) + replacementMemo + code.substring(startIndex + targetMemo.length);
    console.log("Successfully replaced memo start");
} else {
    console.log("Could not find memo start");
}

fs.writeFileSync('./components/AnalyticsView.tsx', code);
