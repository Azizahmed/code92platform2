'use client';

import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  pointerWithin,
  rectIntersection,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent
} from '@dnd-kit/core';
import {useState} from 'react';

export type KanbanColumn<C extends string> = {
  id: C;
  label: string;
  // Tailwind classes for the column's status dot.
  dot?: string;
  footer?: React.ReactNode;
};

type Props<T, C extends string> = {
  columns: KanbanColumn<C>[];
  items: T[];
  getId: (item: T) => string;
  getColumn: (item: T) => C;
  renderCard: (item: T) => React.ReactNode;
  onMove: (item: T, to: C) => void;
  emptyLabel: string;
  // Announced to screen readers; the keyboard flow is space → arrows → space.
  instructions: string;
  // Narrower min column width for boards with many columns.
  columnMinWidth?: string;
};

// Pointer first (precise for mouse/touch), falling back to rectangle overlap
// so keyboard drags and fast flicks still land in a column.
const collision: CollisionDetection = (args) => {
  const hits = pointerWithin(args);
  return hits.length > 0 ? hits : rectIntersection(args);
};

function Column<C extends string>({
  column,
  count,
  children
}: {
  column: KanbanColumn<C>;
  count: number;
  children: React.ReactNode;
}) {
  const {setNodeRef, isOver} = useDroppable({id: column.id});
  return (
    <section
      ref={setNodeRef}
      aria-label={column.label}
      className={`flex min-h-[12rem] flex-col rounded-lg border bg-panel/70 transition-colors ${
        isOver ? 'border-accent/40 bg-accent/5' : 'border-hairline'
      }`}
    >
      <header className="flex items-center justify-between gap-2 border-b border-hairline px-3 py-2.5">
        <span className="flex min-w-0 items-center gap-2 text-[11px] font-medium uppercase tracking-widest text-muted">
          {column.dot ? <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${column.dot}`} /> : null}
          <span className="truncate">{column.label}</span>
        </span>
        <span className="font-mono text-xs text-faint">{count}</span>
      </header>
      <div className="flex flex-1 flex-col gap-2 p-2">{children}</div>
      {column.footer ? (
        <footer className="border-t border-hairline px-3 py-2">{column.footer}</footer>
      ) : null}
    </section>
  );
}

function DraggableCard({id, children}: {id: string; children: React.ReactNode}) {
  const {attributes, listeners, setNodeRef, isDragging} = useDraggable({id});
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={`touch-manipulation rounded-md outline-none focus-visible:ring-2 focus-visible:ring-accent/50 ${
        isDragging ? 'opacity-30' : ''
      }`}
    >
      {children}
    </div>
  );
}

export default function KanbanBoard<T, C extends string>({
  columns,
  items,
  getId,
  getColumn,
  renderCard,
  onMove,
  emptyLabel,
  instructions,
  columnMinWidth = '15rem'
}: Props<T, C>) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const sensors = useSensors(
    // A small distance keeps clicks on links inside cards working.
    useSensor(MouseSensor, {activationConstraint: {distance: 6}}),
    // Press-and-hold on touch so the board can still be scrolled.
    useSensor(TouchSensor, {activationConstraint: {delay: 220, tolerance: 8}}),
    useSensor(KeyboardSensor)
  );

  const byId = new Map(items.map((item) => [getId(item), item]));
  const active = activeId ? byId.get(activeId) : undefined;

  function handleStart(event: DragStartEvent) {
    setActiveId(String(event.active.id));
  }

  function handleEnd(event: DragEndEvent) {
    setActiveId(null);
    const item = byId.get(String(event.active.id));
    const to = event.over?.id as C | undefined;
    if (!item || !to || getColumn(item) === to) return;
    onMove(item, to);
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collision}
      onDragStart={handleStart}
      onDragEnd={handleEnd}
      onDragCancel={() => setActiveId(null)}
      accessibility={{screenReaderInstructions: {draggable: instructions}}}
    >
      {/* The board scrolls sideways inside its own box on narrow screens;
          the page itself never scrolls horizontally. */}
      <div className="-mx-4 overflow-x-auto px-4 pb-2 sm:mx-0 sm:px-0">
        <div
          className="grid gap-3"
          style={{
            gridTemplateColumns: `repeat(${columns.length}, minmax(${columnMinWidth}, 1fr))`
          }}
        >
          {columns.map((column) => {
            const cards = items.filter((item) => getColumn(item) === column.id);
            return (
              <Column key={column.id} column={column} count={cards.length}>
                {cards.length === 0 ? (
                  <p className="flex flex-1 items-center justify-center rounded-md border border-dashed border-hairline px-3 py-6 text-center text-[11px] text-faint">
                    {emptyLabel}
                  </p>
                ) : (
                  cards.map((item) => (
                    <DraggableCard key={getId(item)} id={getId(item)}>
                      {renderCard(item)}
                    </DraggableCard>
                  ))
                )}
              </Column>
            );
          })}
        </div>
      </div>
      <DragOverlay dropAnimation={null}>
        {active ? (
          <div className="rotate-1 cursor-grabbing shadow-2xl">{renderCard(active)}</div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
