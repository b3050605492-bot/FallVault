import type { ReactNode } from 'react';

export function ClickSpark({ children }: { children: ReactNode; sparkColor?: string; sparkCount?: number }) {
  return <>{children}</>;
}
