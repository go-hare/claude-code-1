import { createContext } from 'react';

/**
 * densable tot `vkt`. Sticky header occupies row 0, so toast tops shift by 1.
 * Kept out of FullscreenLayout so ToastStackView does not import the layout.
 */
export const TranscriptOverlayOffsetContext = createContext(0);
