
  const renderPaymentSchedule = (driver: Driver) => {
    const invoices = generateDriverInvoices(driver, new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Kuala_Lumpur" })));
    let anchorFound = false;

    return (
      <div className="space-y-1.5 max-h-[22rem] overflow-y-auto pr-2 scroll-smooth">
        {invoices.map((inv, index) => {
          let isAnchor = false;
          if (!anchorFound && (inv.status === 'PARTIAL' || inv.status === 'UNPAID')) {
            isAnchor = true;
            anchorFound = true;
          }

          let bgColor = 'bg-white';
          let textColor = 'text-gray-600';
          let icon = <XCircle className="w-4 h-4 text-gray-300" />;
          let label = inv.status;
          let showAnchor = isAnchor;
          let pulseClass = isAnchor ? "animate-pulse shadow-[0_0_8px_rgba(239,68,68,0.4)] ring-2 ring-red-400" : "";

          if (inv.status === 'CANCELLED') {
              bgColor = 'bg-gray-100'; textColor = 'text-gray-400'; label = 'CANCELLED'; icon = <XCircle className="w-4 h-4 text-gray-400" />; showAnchor = false; pulseClass = '';
          } else if (inv.status === 'PAID') {
              bgColor = 'bg-emerald-50'; textColor = 'text-emerald-700'; label = 'PAID'; icon = <CheckCircle2 className="w-4 h-4 text-emerald-500" />;
          } else if (inv.status === 'PARTIAL') {
              bgColor = 'bg-amber-50'; textColor = 'text-amber-700'; label = `PARTIAL (${formatCurrency(inv.amountPaid)} paid)`; icon = <AlertCircle className="w-4 h-4 text-amber-500" />;
          } else if (inv.status === 'UNPAID') {
              bgColor = 'bg-red-50'; textColor = 'text-red-700'; label = 'UNPAID'; icon = <AlertCircle className="w-4 h-4 text-red-500" />;
          } else if (inv.status === 'FUTURE') {
              bgColor = 'bg-gray-50'; textColor = 'text-gray-500'; label = 'FUTURE'; icon = <Clock className="w-4 h-4 text-gray-400" />; showAnchor = false; pulseClass = '';
          }

          return (
            <div key={inv.id} id={showAnchor ? "current-payment-anchor" : undefined} className={`flex justify-between items-center p-2.5 rounded-lg border border-gray-100 ${bgColor} ${pulseClass} transition-all duration-300 relative overflow-hidden`}>
              {showAnchor && (
                <div className="absolute top-0 left-0 w-1 h-full bg-red-500 animate-pulse"></div>
              )}
              <div className="flex items-center gap-3">
                <div className="flex flex-col">
                  <span className={`text-[10px] font-bold uppercase tracking-wider ${textColor} mb-0.5`}>Cycle {inv.cycleIndex + 1}</span>
                  <span className="text-sm font-medium text-gray-900">{inv.dueDate}</span>
                </div>
              </div>
              <div className="flex items-center gap-4">
                <span className="font-bold text-gray-900">{formatCurrency(inv.amount)}</span>
                <div className={`flex items-center gap-1.5 ${textColor}`}>
                  {icon}
                  <span className="text-xs font-bold uppercase tracking-wider">{label}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    );
  };
