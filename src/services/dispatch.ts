type AssignStore = {
  [riderId: string]: {
    [date: string]: string[]; // orderIds
  };
};

const KEY = 'dispatch_assignments_v1';

function read(): AssignStore {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function write(store: AssignStore) {
  localStorage.setItem(KEY, JSON.stringify(store));
}

export function getDateStr(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

export function getAssignments(riderId: string, date: string): string[] {
  const store = read();
  return store[riderId]?.[date] || [];
}

export function saveAssignments(riderId: string, date: string, orderIds: string[]) {
  const store = read();
  if (!store[riderId]) store[riderId] = {} as any;
  store[riderId][date] = Array.from(new Set(orderIds));
  write(store);
}

export function clearAssignments(riderId: string, date: string) {
  const store = read();
  if (store[riderId]?.[date]) {
    delete store[riderId][date];
    write(store);
  }
}

