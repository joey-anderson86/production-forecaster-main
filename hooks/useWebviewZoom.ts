'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { notifications } from '@mantine/notifications';

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 3.0;
const ZOOM_STEP = 0.1;

export function useWebviewZoom() {
  const [zoomLevel, setZoomLevel] = useState(1.0);
  const isInitialMount = useRef(true);

  const adjustZoom = useCallback((delta: number) => {
    setZoomLevel((prev) => {
      const newZoom = prev + delta;
      const clampedZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, newZoom));
      return Math.round(clampedZoom * 10) / 10;
    });
  }, []);

  const resetZoom = useCallback(() => {
    setZoomLevel(1.0);
  }, []);

  // Handle Side Effects (CSS & Notifications)
  useEffect(() => {
    // Apply zoom
    document.body.style.zoom = zoomLevel.toString();

    // Show notification (skip initial mount to avoid 100% on load)
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }

    notifications.show({
      id: 'zoom-notification',
      title: 'Zoom Level',
      message: `${Math.round(zoomLevel * 100)}%`,
      color: 'blue',
      autoClose: 1000,
      withCloseButton: false,
    });
  }, [zoomLevel]);

  useEffect(() => {
    const handleWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const delta = e.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP;
        adjustZoom(delta);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      const isModifier = e.ctrlKey || e.metaKey;
      
      if (isModifier) {
        if (e.key === '=' || e.key === '+') {
          e.preventDefault();
          adjustZoom(ZOOM_STEP);
        } else if (e.key === '-') {
          e.preventDefault();
          adjustZoom(-ZOOM_STEP);
        } else if (e.key === '0') {
          e.preventDefault();
          resetZoom();
        }
      }
    };

    // Prevent selection during zoom with mouse wheel
    const handlePointerDown = (e: PointerEvent) => {
      if (e.ctrlKey || e.metaKey) {
        document.body.style.userSelect = 'none';
      }
    };

    const handlePointerUp = () => {
      document.body.style.userSelect = 'auto';
    };

    window.addEventListener('wheel', handleWheel, { passive: false });
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('pointerup', handlePointerUp);
    
    return () => {
      window.removeEventListener('wheel', handleWheel);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('pointerup', handlePointerUp);
    };
  }, [adjustZoom, resetZoom]); // Removed zoomLevel dependency

  return { zoomLevel, adjustZoom, resetZoom };
}
