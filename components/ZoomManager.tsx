'use client';

import { useWebviewZoom } from '../hooks/useWebviewZoom';

/**
 * ZoomManager is a client component that initializes the zoom hook.
 * It doesn't render any UI itself, but manages the global zoom state and listeners.
 */
export function ZoomManager() {
  useWebviewZoom();
  return null;
}
