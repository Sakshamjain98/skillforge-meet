// Re-export react-hot-toast so all components import from one consistent path.
// You can swap the underlying library here without touching any component.
export { default as toast, Toaster } from 'react-hot-toast';
export type { Toast as ToastType } from 'react-hot-toast';