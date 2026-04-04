import { useEffect } from 'react';
import { animation } from '../design-system/tokens';

interface PreferenceHighlightProps {
  children: React.ReactNode;
  isHighlighted: boolean;
  onHighlightEnd: () => void;
}

export function PreferenceHighlight({ children, isHighlighted, onHighlightEnd }: PreferenceHighlightProps) {
  useEffect(() => {
    if (!isHighlighted) return;

    const timer = setTimeout(() => {
      onHighlightEnd();
    }, animation.durations.slow);

    return () => clearTimeout(timer);
  }, [isHighlighted, onHighlightEnd]);

  return <div>{children}</div>;
}
