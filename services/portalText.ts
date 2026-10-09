import { formatDate, parseDate } from '../utils.ts';

/** The driver page's languages: English, Bahasa Malaysia and Simplified Chinese. */
export type PortalLang = 'en' | 'ms' | 'zh';
export const PORTAL_LANGS: { code: PortalLang; label: string }[] = [
  { code: 'en', label: 'EN' },
  { code: 'ms', label: 'BM' },
  { code: 'zh', label: '中文' },
];

const LANG_KEY = 'eca.driverLang';

/** The language this phone chose last time, or English. */
export const loadPortalLang = (storage: Pick<Storage, 'getItem'> | null): PortalLang => {
  try {
    const saved = storage?.getItem(LANG_KEY);
    return saved === 'ms' || saved === 'zh' ? saved : 'en';
  } catch {
    return 'en';
  }
};
export const savePortalLang = (storage: Pick<Storage, 'setItem'> | null, lang: PortalLang) => {
  try { storage?.setItem(LANG_KEY, lang); } catch { /* storage blocked: the choice lasts this visit */ }
};

/** A date in the driver's language: 13 Oct 2026, 13 Okt 2026, 2026年10月13日. */
export const portalDate = (value: string | Date, lang: PortalLang): string => {
  if (lang === 'en') return formatDate(value);
  const date = parseDate(value);
  if (isNaN(date.getTime())) return '—';
  if (lang === 'zh') return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
  const months = ['Jan', 'Feb', 'Mac', 'Apr', 'Mei', 'Jun', 'Jul', 'Ogo', 'Sep', 'Okt', 'Nov', 'Dis'];
  return `${String(date.getDate()).padStart(2, '0')} ${months[date.getMonth()]} ${date.getFullYear()}`;
};

/** A clock time such as 10:32. */
export const portalTime = (date: Date): string => `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;

type Text = {
  upToDateTitle: string;
  upToDate: (amount: string, date: string) => string;
  nothingOwed: string;
  catchUpTitle: string;
  catchUp: (amount: string) => string;
  behindTitle: string;
  behind: (amount: string) => string;
  finalTitle: string;
  final: (amount: string) => string;
  closedTitle: string;
  closed: string;
  clearAll: (amount: string) => string;
  nextStep: (step: string, level: string) => string;
  thanks: (amount: string, date: string) => string;
  progress: (unit: 'week' | 'month', shown: number, of: number) => string;
  pastLength: string;
  percent: (percent: number) => string;
  car: string;
  type: string;
  rent: string;
  started: string;
  ends: string;
  length: string;
  rentToOwn: string;
  rental: string;
  weekdays: string[];
  everyWeekday: (day: string) => string;
  monthly: (day: number, shortMonthNote: boolean) => string;
  lengthValue: (count: number, unit: 'week' | 'month') => string;
  hello: string;
  youOwe: string;
  rentPer: (unit: 'week' | 'month') => string;
  penaltyTitle: string;
  penaltyToday: (amount: string) => string;
  penaltyNote: string;
  nextPayment: string;
  unpaidSince: (date: string) => string;
  amountOn: (amount: string, date: string) => string;
  comingUp: string;
  whereToPay: string;
  ownTitle: string;
  rentalTitle: string;
  myContract: string;
  myAgreement: string;
  agreementMade: (date: string) => string;
  viewAgreement: string;
  downloadAgreement: string;
  downloading: string;
  recent: string;
  noPayments: string;
  logOut: string;
  refresh: string;
  refreshing: string;
  updated: (time: string) => string;
  refreshFailed: string;
  installTitle: string;
  installAction: string;
  installAndroid: string;
  installIos: string;
  installMenu: string;
  notNow: string;
  language: string;
  driverLogin: string;
  nricLabel: string;
  checkDashboard: string;
  checking: string;
  remember: string;
  enterNric: string;
  notFound: string;
  rateLimited: string;
  unavailable: string;
};

const en: Text = {
  upToDateTitle: "You're up to date",
  upToDate: (amount, date) => `Your next rent of ${amount} is due on ${date}.`,
  nothingOwed: 'Nothing is owed. Thank you.',
  catchUpTitle: 'Rent to catch up',
  catchUp: amount => `You have ${amount} to catch up. Thank you for every payment.`,
  behindTitle: "Let's catch up",
  behind: amount => `You have ${amount} to catch up. Every payment brings it down. Message the office if you'd like a payment plan.`,
  finalTitle: 'Final settlement',
  final: amount => `${amount} is left to settle to close your account. Message the office if you'd like to arrange it.`,
  closedTitle: 'Account closed',
  closed: 'Your rental has ended with nothing owed. Thank you.',
  clearAll: amount => `Pay ${amount} and you're fully up to date.`,
  nextStep: (step, level) => `Next step: pay ${step} to bring it down to ${level}.`,
  thanks: (amount, date) => `Last payment ${amount} on ${date}. Thank you!`,
  progress: (unit, shown, of) => `${unit === 'month' ? 'Month' : 'Week'} ${shown} of ${of}`,
  pastLength: 'Contract length reached. Rent continues until your contract is closed.',
  percent: percent => `${percent}% of the contract`,
  car: 'Car',
  type: 'Type',
  rent: 'Rent',
  started: 'Started',
  ends: 'Ends',
  length: 'Length',
  rentToOwn: 'Rent-to-own (Sewa Beli)',
  rental: 'Rental (Sewa Biasa)',
  weekdays: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
  everyWeekday: day => ` every ${day}`,
  monthly: (day, note) => {
    const tens = day % 100;
    const suffix = tens >= 11 && tens <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[day % 10] ?? 'th';
    return ` on the ${day}${suffix} of each month${note ? ' (or the last day of a shorter month)' : ''}`;
  },
  lengthValue: (count, unit) => `${count} ${unit}${count === 1 ? '' : 's'}`,
  hello: 'Hello',
  youOwe: 'You owe',
  rentPer: unit => `Rent per ${unit}`,
  penaltyTitle: 'Late penalty so far',
  penaltyToday: amount => `+${amount} today`,
  penaltyNote: '18% a year on unpaid rent, added daily. Paying sooner stops it growing.',
  nextPayment: 'Next payment',
  unpaidSince: date => `Unpaid since ${date}.`,
  amountOn: (amount, date) => `${amount} on ${date}.`,
  comingUp: 'Coming up',
  whereToPay: 'Pay to the account on your WhatsApp group statement, then send the receipt in the same group.',
  ownTitle: 'On the way to owning this car',
  rentalTitle: 'Rental progress',
  myContract: 'My contract',
  myAgreement: 'My agreement',
  agreementMade: date => `Prepared by the office on ${date}.`,
  viewAgreement: 'View',
  downloadAgreement: 'Download PDF',
  downloading: 'Preparing…',
  recent: 'Recent payments',
  noPayments: 'No payments recorded yet.',
  logOut: 'Log out',
  refresh: 'Refresh',
  refreshing: 'Refreshing…',
  updated: time => `Updated ${time}`,
  refreshFailed: "Couldn't refresh. Check your connection and try again.",
  installTitle: 'Add ECA to your home screen',
  installAction: 'Add',
  installAndroid: 'Open it like an app next time.',
  installIos: 'Tap Share, then "Add to Home Screen".',
  installMenu: 'Open your browser menu (⋮), then "Add to Home screen".',
  notNow: 'Not now',
  language: 'Language',
  driverLogin: 'Driver Login',
  nricLabel: 'NRIC Number',
  checkDashboard: 'Check My Dashboard',
  checking: 'Checking…',
  remember: 'Keep me signed in on this phone for 30 days',
  enterNric: 'Please enter your NRIC',
  notFound: 'Driver not found. Please check your NRIC.',
  rateLimited: 'Too many attempts. Please wait a minute and try again.',
  unavailable: 'Driver sign-in is not available right now. Please try again later.',
};

const ms: Text = {
  upToDateTitle: 'Tiada tunggakan',
  upToDate: (amount, date) => `Sewa seterusnya ${amount} perlu dibayar pada ${date}.`,
  nothingOwed: 'Tiada baki tertunggak. Terima kasih.',
  catchUpTitle: 'Baki sewa untuk dijelaskan',
  catchUp: amount => `Anda ada baki ${amount} untuk dijelaskan. Terima kasih atas setiap bayaran.`,
  behindTitle: 'Mari jelaskan baki',
  behind: amount => `Anda ada baki ${amount} untuk dijelaskan. Setiap bayaran mengurangkannya. Hubungi pejabat jika anda mahukan pelan bayaran.`,
  finalTitle: 'Penyelesaian akhir',
  final: amount => `Baki ${amount} perlu dijelaskan untuk menutup akaun anda. Hubungi pejabat untuk mengaturnya.`,
  closedTitle: 'Akaun ditutup',
  closed: 'Sewaan anda telah tamat tanpa sebarang baki. Terima kasih.',
  clearAll: amount => `Bayar ${amount} dan anda tiada lagi tunggakan.`,
  nextStep: (step, level) => `Langkah seterusnya: bayar ${step} untuk kurangkan baki kepada ${level}.`,
  thanks: (amount, date) => `Bayaran terakhir ${amount} pada ${date}. Terima kasih!`,
  progress: (unit, shown, of) => `${unit === 'month' ? 'Bulan' : 'Minggu'} ${shown} daripada ${of}`,
  pastLength: 'Tempoh kontrak telah dicapai. Sewa diteruskan sehingga kontrak anda ditutup.',
  percent: percent => `${percent}% daripada kontrak`,
  car: 'Kereta',
  type: 'Jenis',
  rent: 'Sewa',
  started: 'Bermula',
  ends: 'Tamat',
  length: 'Tempoh',
  rentToOwn: 'Sewa Beli',
  rental: 'Sewa Biasa',
  weekdays: ['Ahad', 'Isnin', 'Selasa', 'Rabu', 'Khamis', 'Jumaat', 'Sabtu'],
  everyWeekday: day => ` setiap ${day}`,
  monthly: (day, note) => ` pada ${day} haribulan setiap bulan${note ? ' (atau hari terakhir bagi bulan yang lebih pendek)' : ''}`,
  lengthValue: (count, unit) => `${count} ${unit === 'month' ? 'bulan' : 'minggu'}`,
  hello: 'Hai',
  youOwe: 'Baki tertunggak',
  rentPer: unit => (unit === 'month' ? 'Sewa sebulan' : 'Sewa seminggu'),
  penaltyTitle: 'Penalti lewat setakat ini',
  penaltyToday: amount => `+${amount} hari ini`,
  penaltyNote: '18% setahun ke atas sewa tertunggak, dikira setiap hari. Bayar lebih awal supaya ia berhenti bertambah.',
  nextPayment: 'Bayaran seterusnya',
  unpaidSince: date => `Belum dibayar sejak ${date}.`,
  amountOn: (amount, date) => `${amount} pada ${date}.`,
  comingUp: 'Akan datang',
  whereToPay: 'Bayar ke akaun pada penyata dalam kumpulan WhatsApp anda, kemudian hantar resit dalam kumpulan yang sama.',
  ownTitle: 'Menuju pemilikan kereta ini',
  rentalTitle: 'Kemajuan sewaan',
  myContract: 'Kontrak saya',
  myAgreement: 'Perjanjian saya',
  agreementMade: date => `Disediakan oleh pejabat pada ${date}.`,
  viewAgreement: 'Lihat',
  downloadAgreement: 'Muat turun PDF',
  downloading: 'Sedang disediakan…',
  recent: 'Bayaran terkini',
  noPayments: 'Belum ada bayaran direkodkan.',
  logOut: 'Log keluar',
  refresh: 'Muat semula',
  refreshing: 'Memuat semula…',
  updated: time => `Dikemas kini ${time}`,
  refreshFailed: 'Gagal memuat semula. Semak sambungan anda dan cuba lagi.',
  installTitle: 'Tambah ECA ke skrin utama',
  installAction: 'Tambah',
  installAndroid: 'Buka seperti aplikasi lain kali.',
  installIos: 'Tekan Kongsi, kemudian "Tambah ke Skrin Utama".',
  installMenu: 'Buka menu pelayar (⋮), kemudian "Tambah ke skrin utama".',
  notNow: 'Bukan sekarang',
  language: 'Bahasa',
  driverLogin: 'Log Masuk Pemandu',
  nricLabel: 'Nombor MyKad',
  checkDashboard: 'Semak Akaun Saya',
  checking: 'Menyemak…',
  remember: 'Kekal log masuk di telefon ini selama 30 hari',
  enterNric: 'Sila masukkan nombor MyKad anda',
  notFound: 'Pemandu tidak dijumpai. Sila semak nombor MyKad anda.',
  rateLimited: 'Terlalu banyak cubaan. Sila tunggu seminit dan cuba lagi.',
  unavailable: 'Log masuk pemandu tidak tersedia buat masa ini. Sila cuba sebentar lagi.',
};

const zh: Text = {
  upToDateTitle: '您的租金已付清',
  upToDate: (amount, date) => `下一期租金 ${amount}，到期日为 ${date}。`,
  nothingOwed: '目前没有欠款，谢谢。',
  catchUpTitle: '待补交租金',
  catchUp: amount => `您有 ${amount} 待补交。感谢您的每一笔付款。`,
  behindTitle: '我们一起来补上吧',
  behind: amount => `您有 ${amount} 待补交。每一笔付款都能减少余额。如需分期付款安排，请联系办公室。`,
  finalTitle: '最终结算',
  final: amount => `尚有 ${amount} 待结清，结清后即可关闭账户。如需安排，请联系办公室。`,
  closedTitle: '账户已关闭',
  closed: '您的租约已结束，没有欠款。谢谢。',
  clearAll: amount => `支付 ${amount} 即可全部付清。`,
  nextStep: (step, level) => `下一步：支付 ${step}，余额即可降至 ${level}。`,
  thanks: (amount, date) => `最近一笔付款：${date} 支付 ${amount}。谢谢！`,
  progress: (unit, shown, of) => (unit === 'month' ? `第 ${shown} 个月，共 ${of} 个月` : `第 ${shown} 周，共 ${of} 周`),
  pastLength: '合约期已满。租金将继续计算，直到合约结束。',
  percent: percent => `已完成合约的 ${percent}%`,
  car: '车辆',
  type: '类型',
  rent: '租金',
  started: '开始日期',
  ends: '结束日期',
  length: '合约期',
  rentToOwn: '租购 (Sewa Beli)',
  rental: '租赁 (Sewa Biasa)',
  weekdays: ['周日', '周一', '周二', '周三', '周四', '周五', '周六'],
  everyWeekday: day => `，每${day}`,
  monthly: (day, note) => `，每月 ${day} 日${note ? '（若当月没有这一天，则为该月最后一天）' : ''}`,
  lengthValue: (count, unit) => `${count} ${unit === 'month' ? '个月' : '周'}`,
  hello: '您好',
  youOwe: '欠款',
  rentPer: unit => (unit === 'month' ? '每月租金' : '每周租金'),
  penaltyTitle: '目前累计滞纳金',
  penaltyToday: amount => `今日 +${amount}`,
  penaltyNote: '未付租金按年利率 18% 每日累计。尽早付款即可停止增加。',
  nextPayment: '下次付款',
  unpaidSince: date => `自 ${date} 起未付。`,
  amountOn: (amount, date) => `${date} 支付 ${amount}。`,
  comingUp: '即将到期',
  whereToPay: '请转账至 WhatsApp 群组账单上的账户，然后在同一群组发送收据。',
  ownTitle: '离拥有这辆车越来越近',
  rentalTitle: '租赁进度',
  myContract: '我的合约',
  myAgreement: '我的协议',
  agreementMade: date => `办公室于 ${date} 准备。`,
  viewAgreement: '查看',
  downloadAgreement: '下载 PDF',
  downloading: '准备中…',
  recent: '最近付款',
  noPayments: '暂无付款记录。',
  logOut: '退出登录',
  refresh: '刷新',
  refreshing: '正在刷新…',
  updated: time => `更新于 ${time}`,
  refreshFailed: '刷新失败，请检查网络后重试。',
  installTitle: '将 ECA 添加到主屏幕',
  installAction: '添加',
  installAndroid: '下次可像应用程序一样直接打开。',
  installIos: '点击“分享”，然后选择“添加到主屏幕”。',
  installMenu: '打开浏览器菜单 (⋮)，然后选择“添加到主屏幕”。',
  notNow: '以后再说',
  language: '语言',
  driverLogin: '司机登录',
  nricLabel: '身份证号码 (NRIC)',
  checkDashboard: '查看我的账户',
  checking: '正在查询…',
  remember: '在此手机上保持登录 30 天',
  enterNric: '请输入您的身份证号码',
  notFound: '找不到司机记录，请检查您的身份证号码。',
  rateLimited: '尝试次数过多，请稍等一分钟后再试。',
  unavailable: '司机登录暂时无法使用，请稍后再试。',
};

const TEXT: Record<PortalLang, Text> = { en, ms, zh };

/** Every word the driver page and the driver login show, in one language. */
export const portalText = (lang: PortalLang): Text => TEXT[lang];
