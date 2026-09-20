import { create } from 'zustand';

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface ToastItem {
  id: string;
  message: string;
  type: 'success' | 'error' | 'warning' | 'info';
  action?: ToastAction;
}

interface ToastState {
  toasts: ToastItem[];
  addToast: (message: string, type: ToastItem['type'], action?: ToastAction) => void;
  removeToast: (id: string) => void;
}

let toastId = 0;

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  addToast: (message, type, action) => {
    const id = `toast-${++toastId}`;
    set((state) => ({ toasts: [...state.toasts, { id, message, type, action }] }));
  },
  removeToast: (id) =>
    set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),
}));
