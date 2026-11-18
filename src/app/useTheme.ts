import { useEffect } from 'react';
import { useUiStore } from '@/stores/uiStore';

/** Applies the theme preference as a `dark` class on <html>, following the OS for "system". */
export function useTheme(): void {
  const theme = useUiStore((s) => s.theme);
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const dark = theme === 'dark' || (theme === 'system' && media.matches);
      document.documentElement.classList.toggle('dark', dark);
    };
    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [theme]);
}
