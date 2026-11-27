import { createContext, useContext } from 'react';

/** How the 3D scene is being drawn: normal editing, a photo-style render or a line sketch. */
export interface RenderStyle {
  mode: 'edit' | 'photo' | 'sketch';
}

export const RenderStyleContext = createContext<RenderStyle>({ mode: 'edit' });
export const useRenderStyle = () => useContext(RenderStyleContext);

export const SKETCH_EDGE = '#2a2a2a';
