import { useCallback, useEffect, useState } from 'react';
import {
  applyTheme,
  getStoredTheme,
  resolveTheme,
  storeTheme,
  subscribeToSystemTheme,
  type ResolvedTheme,
  type ThemeMode,
} from '@/lib/theme';

export function useTheme(): {
  mode: ThemeMode;
  resolved: ResolvedTheme;
  setMode: (mode: ThemeMode) => void;
  toggle: () => void;
} {
  const [mode, setMode] = useState<ThemeMode>(getStoredTheme);
  const [resolved, setResolved] = useState<ResolvedTheme>(() => resolveTheme(getStoredTheme()));

  useEffect(() => {
    setResolved(applyTheme(mode));

    if (mode !== 'system') return;
    return subscribeToSystemTheme(() => {
      setResolved(applyTheme('system'));
    });
  }, [mode]);

  const updateMode = useCallback((next: ThemeMode) => {
    storeTheme(next);
    setMode(next);
  }, []);

  const toggle = useCallback(() => {
    updateMode(resolved === 'dark' ? 'light' : 'dark');
  }, [resolved, updateMode]);

  return { mode, resolved, setMode: updateMode, toggle };
}
