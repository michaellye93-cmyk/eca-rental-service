import fs from 'fs';
let content = fs.readFileSync('./components/AdminDashboard.tsx', 'utf8');

const target = `    if (editingId) {
      const originalDriver = drivers.find(d => d.id === editingId);
      if (!originalDriver) return;
      await onUpdateDriver({ ...originalDriver, ...submissionData });
    } else {
      if (drivers.some(d => d.nric === formData.nric)) { alert("NRIC exists."); return; }
      await onCreateDriver({ id: Date.now().toString(), ...submissionData, totalAmountPaid: 0, paymentHistory: [] });
    }
    // Immediate Refresh on Update
    await onRefresh();
    setIsDriverModalOpen(false); setFormData(initialFormState);
  };`;

const replacement = `    try {
      if (editingId) {
        const originalDriver = drivers.find(d => d.id === editingId);
        if (!originalDriver) return;
        await onUpdateDriver({ ...originalDriver, ...submissionData });
      } else {
        if (drivers.some(d => d.nric === formData.nric)) { alert("NRIC exists."); return; }
        await onCreateDriver({ id: Date.now().toString(), ...submissionData, totalAmountPaid: 0, paymentHistory: [] });
      }
      // Immediate Refresh on Update
      await onRefresh();
      setIsDriverModalOpen(false); setFormData(initialFormState);
    } catch (e) {
      // Error handled by parent, keep modal open
    }
  };`;

content = content.replace(target, replacement);
fs.writeFileSync('./components/AdminDashboard.tsx', content);
