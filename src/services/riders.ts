type AttendanceStatus = '出勤' | '请假';

type ContactInfo = {
  phone?: string;
  address?: string;
  emergency?: string;
};

type AttendanceRecord = {
  status: AttendanceStatus;
  note?: string;
};

type RiderCareStore = {
  contacts: Record<string, ContactInfo>;
  attendanceByDate: Record<string, Record<string, AttendanceRecord>>;
};

const KEY = 'riderCareStore';

function readStore(): RiderCareStore {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { contacts: {}, attendanceByDate: {} };
    const parsed = JSON.parse(raw);
    return {
      contacts: parsed.contacts || {},
      attendanceByDate: parsed.attendanceByDate || {},
    };
  } catch {
    return { contacts: {}, attendanceByDate: {} };
  }
}

function writeStore(store: RiderCareStore) {
  localStorage.setItem(KEY, JSON.stringify(store));
}

export function loadContacts(): Record<string, ContactInfo> {
  return readStore().contacts;
}

export function saveContact(riderId: string, info: ContactInfo) {
  const store = readStore();
  store.contacts[riderId] = { ...store.contacts[riderId], ...info };
  writeStore(store);
}

export function loadAttendance(date: string): Record<string, AttendanceRecord> {
  const store = readStore();
  return store.attendanceByDate[date] || {};
}

export function saveAttendance(date: string, riderId: string, record: AttendanceRecord) {
  const store = readStore();
  if (!store.attendanceByDate[date]) store.attendanceByDate[date] = {};
  store.attendanceByDate[date][riderId] = record;
  writeStore(store);
}

export function attendanceSummary(date: string, riderIds: string[]): { present: number; leave: number } {
  const records = loadAttendance(date);
  let present = 0, leave = 0;
  riderIds.forEach(id => {
    const r = records[id];
    if (r?.status === '请假') leave += 1; else present += 1;
  });
  return { present, leave };
}

export function today(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

