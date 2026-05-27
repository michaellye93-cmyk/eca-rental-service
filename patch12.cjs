const fs = require('fs');

let content = fs.readFileSync('components/AdminDashboard.tsx', 'utf-8');

// 1. Tooltips for the arrows
const arrowRegex = /\{v\.isSlipping && <TrendingDown className="w-4 h-4 text-rose-500 animate-bounce" \/>\}\s*\{v\.isRecovering && <TrendingUp className="w-4 h-4 text-emerald-500" \/>\}/;

const newArrows = `{v.isSlipping && <div title="Driver's payment behavior is worsening" className="cursor-help inline-flex"><TrendingDown className="w-4 h-4 text-rose-500 animate-bounce" /></div>}
                                                                 {v.isRecovering && <div title="Driver's payment behavior is improving" className="cursor-help inline-flex"><TrendingUp className="w-4 h-4 text-emerald-500" /></div>}`;

if (content.match(arrowRegex)) {
    content = content.replace(arrowRegex, newArrows);
    console.log("Arrows patched");
} else {
    console.log("Arrows regex failed");
}

// 2. Add Contract End Date and Datalist for Tags
const modalRegex = /<div className="grid grid-cols-2 gap-4">\s*<div>\s*<label className="block text-sm font-bold text-gray-700 mb-1">Start Date<\/label>\s*<input required type="date".*?\/>\s*<\/div>\s*<div>\s*<label className="block text-sm font-bold text-gray-700 mb-1">Duration \(Weeks\)<\/label>\s*<input required type="number".*?\/>\s*<\/div>\s*<\/div>\s*<div>\s*<label className="block text-sm font-bold text-gray-700 mb-1">Tags \(Press Enter\)<\/label>\s*<div className="flex gap-2">/mg;

const newModalData = `<div className="grid grid-cols-3 gap-4">
                                    <div>
                                        <label className="block text-sm font-bold text-gray-700 mb-1">Start Date</label>
                                        <input required type="date" className="w-full border border-gray-300 rounded p-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none" value={formData.contractStartDate} onChange={e => setFormData({...formData, contractStartDate: e.target.value})} />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-bold text-gray-700 mb-1">Duration (Wks)</label>
                                        <input required type="number" className="w-full border border-gray-300 rounded p-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none" value={formData.contractDuration} onChange={e => setFormData({...formData, contractDuration: Number(e.target.value)})} min="1" />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-bold text-gray-700 mb-1">End Date</label>
                                        <input type="date" className="w-full border border-gray-300 rounded p-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none" value={formData.contractEndDate} onChange={e => setFormData({...formData, contractEndDate: e.target.value})} />
                                    </div>
                                </div>
                                <div>
                                    <label className="block text-sm font-bold text-gray-700 mb-1">Tags (Press Enter)</label>
                                    <div className="flex gap-2">
                                        <input type="text" list="existing-tags" className="flex-1 border border-gray-300 rounded p-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none" placeholder="e.g. SUN" value={tagInput} onChange={e => setTagInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddTag(e); } }} />
                                        <datalist id="existing-tags">
                                            {Array.from(new Set(drivers.flatMap(d => d.tags || []))).sort().map(tag => <option key={tag} value={tag} />)}
                                        </datalist>`;

if (content.match(modalRegex)) {
    content = content.replace(modalRegex, newModalData);
    console.log("Modal patched");
} else {
    console.log("Modal regex failed");
}

fs.writeFileSync('components/AdminDashboard.tsx', content);
