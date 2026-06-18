import { useEffect, useRef, useState, type ReactNode, type PointerEvent as RP } from "react";
import { Reorder, useDragControls, AnimatePresence, motion } from "framer-motion";
import { GripVertical, Check } from "lucide-react";

export type LobSlot = {
  key: string;
  render: (helpers: { dragHandleProps: object; isReordering: boolean }) => ReactNode;
};

/**
 * Long-press-to-reorder list. Holding any card for ~400ms enables a
 * reorder mode where every card shows a drag handle and can be dragged
 * up/down. A floating "Done" pill exits reorder mode.
 */
export function LobReorderable({
  slots,
  onReorder,
}: {
  slots: LobSlot[];
  onReorder: (next: string[]) => void;
}) {
  const [reordering, setReordering] = useState(false);
  const items = slots.map((s) => s.key);

  return (
    <div className="relative">
      <Reorder.Group
        axis="y"
        values={items}
        onReorder={onReorder}
        className="space-y-2 list-none"
        as="ul"
      >
        {slots.map((slot) => (
          <LobReorderItem
            key={slot.key}
            id={slot.key}
            reordering={reordering}
            onLongPress={() => setReordering(true)}
          >
            {(helpers) => slot.render(helpers)}
          </LobReorderItem>
        ))}
      </Reorder.Group>
      <AnimatePresence>
        {reordering && (
          <motion.button
            type="button"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            onClick={() => setReordering(false)}
            className="sticky bottom-2 mt-3 inline-flex w-full items-center justify-center gap-2 rounded-full border border-cyan-400/60 bg-cyan-500/20 px-4 py-2 text-sm font-semibold text-cyan-100 shadow-[0_0_20px_rgba(6,182,212,0.35)] backdrop-blur"
          >
            <Check className="h-4 w-4" /> Done reordering
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  );
}

function LobReorderItem({
  id,
  reordering,
  onLongPress,
  children,
}: {
  id: string;
  reordering: boolean;
  onLongPress: () => void;
  children: (helpers: { dragHandleProps: object; isReordering: boolean }) => ReactNode;
}) {
  const controls = useDragControls();
  const timerRef = useRef<number | null>(null);
  const startPos = useRef<{ x: number; y: number } | null>(null);

  const cancelTimer = () => {
    if (timerRef.current != null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  useEffect(() => () => cancelTimer(), []);

  const handlePointerDown = (e: RP<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    // Always allow form controls to receive their own clicks/taps.
    const onControl = !!target.closest("button, input, select, textarea, [role=switch]");
    if (reordering) {
      if (!onControl) controls.start(e);
      return;
    }
    if (onControl) return;
    startPos.current = { x: e.clientX, y: e.clientY };
    cancelTimer();
    timerRef.current = window.setTimeout(() => {
      onLongPress();
      // navigator.vibrate is optional & non-essential; ignore failures.
      try { (navigator as any).vibrate?.(15); } catch { /* noop */ }
    }, 400);
  };

  const handlePointerMove = (e: RP<HTMLDivElement>) => {
    if (!startPos.current) return;
    const dx = e.clientX - startPos.current.x;
    const dy = e.clientY - startPos.current.y;
    if (Math.hypot(dx, dy) > 8) cancelTimer();
  };

  const handlePointerUp = () => {
    cancelTimer();
    startPos.current = null;
  };

  return (
    <Reorder.Item
      value={id}
      as="li"
      dragListener={false}
      dragControls={controls}
      whileDrag={{ scale: 1.02, boxShadow: "0 20px 40px -10px rgba(6,182,212,0.4)" }}
      transition={{ duration: 0.18 }}
    >
      <div
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        className="relative touch-none"
      >
        {reordering && (
          <div
            onPointerDown={(e) => controls.start(e)}
            className="absolute -left-1 top-1/2 z-10 -translate-y-1/2 cursor-grab rounded-md bg-background/80 p-1 text-cyan-300 shadow ring-1 ring-cyan-400/40 active:cursor-grabbing"
            aria-label="Drag to reorder"
          >
            <GripVertical className="h-4 w-4" />
          </div>
        )}
        {children({ dragHandleProps: {}, isReordering: reordering })}
      </div>
    </Reorder.Item>
  );
}