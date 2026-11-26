import { Shape } from 'react-konva';
import type { ViewTransform } from './view';
import type { Palette } from '../theme';

interface Props {
  view: ViewTransform;
  width: number;
  height: number;
  gridSize: number;
  palette: Palette;
}

/** Screen-space grid: minor lines every gridSize, major lines every metre, origin axes. */
export function Grid({ view, width, height, gridSize, palette }: Props) {
  return (
    <Shape
      listening={false}
      perfectDrawEnabled={false}
      sceneFunc={(kctx) => {
        const ctx = kctx._context as CanvasRenderingContext2D;
        const draw = (step: number, color: string) => {
          const px = step * view.scale;
          if (px < 7) return;
          ctx.beginPath();
          const x0 = Math.floor(-view.x / px) * px + view.x;
          for (let x = x0; x <= width; x += px) {
            const sx = Math.round(x) + 0.5;
            ctx.moveTo(sx, 0);
            ctx.lineTo(sx, height);
          }
          const y0 = Math.floor(-view.y / px) * px + view.y;
          for (let y = y0; y <= height; y += px) {
            const sy = Math.round(y) + 0.5;
            ctx.moveTo(0, sy);
            ctx.lineTo(width, sy);
          }
          ctx.strokeStyle = color;
          ctx.lineWidth = 1;
          ctx.stroke();
        };
        draw(gridSize, palette.gridMinor);
        // major grid: 1 m, or 10 m when zoomed far out
        draw(1000 * view.scale >= 7 ? 1000 : 10000, palette.gridMajor);
        ctx.beginPath();
        ctx.moveTo(Math.round(view.x) + 0.5, 0);
        ctx.lineTo(Math.round(view.x) + 0.5, height);
        ctx.moveTo(0, Math.round(view.y) + 0.5);
        ctx.lineTo(width, Math.round(view.y) + 0.5);
        ctx.strokeStyle = palette.axis;
        ctx.stroke();
      }}
    />
  );
}
