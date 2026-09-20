import { create } from 'zustand';
import type { IntegrityReport } from '@/lib/crypto';

export const useIntegrityStore = create<{
  report: IntegrityReport | null;
  isOpen: boolean;
  setReport: (report: IntegrityReport | null) => void;
  setOpen: (open: boolean) => void;
}>((set) => ({
  report: null,
  isOpen: false,
  setReport: (report) => set({ report, ...(report === null ? { isOpen: false } : {}) }),
  setOpen: (isOpen) => set({ isOpen }),
}));
