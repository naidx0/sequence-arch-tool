import type { CanvasDoc, CanvasStoryRoute } from '../state/types';

export interface CanvasStoryNavProps {
  route: CanvasStoryRoute;
  activeIndex: number;
  onStep: (index: number) => void;
}

export function CanvasStoryNav({ route, activeIndex, onStep }: CanvasStoryNavProps) {
  const total = route.steps.length;
  if (total === 0) return null;

  return (
    <nav className="ai-canvas-story" data-testid="ai-canvas-story-nav" aria-label="Guided story">
      <div className="ai-canvas-story-hd">
        <span className="ai-canvas-story-title">{route.title}</span>
        <span className="ai-canvas-story-count">
          {activeIndex + 1} / {total}
        </span>
      </div>
      <ol className="ai-canvas-story-steps">
        {route.steps.map((step, index) => (
          <li key={step.blockId}>
            <button
              type="button"
              className={`ai-canvas-story-step${index === activeIndex ? ' active' : ''}`}
              data-testid={`ai-canvas-story-step-${index}`}
              onClick={() => onStep(index)}
            >
              {step.caption}
            </button>
          </li>
        ))}
      </ol>
      <div className="ai-canvas-story-controls">
        <button
          type="button"
          className="ai-canvas-story-ctrl"
          disabled={activeIndex <= 0}
          onClick={() => onStep(activeIndex - 1)}
        >
          Previous
        </button>
        <button
          type="button"
          className="ai-canvas-story-ctrl"
          disabled={activeIndex >= total - 1}
          onClick={() => onStep(activeIndex + 1)}
        >
          Next
        </button>
      </div>
    </nav>
  );
}

export function activeStoryBlockId(doc: CanvasDoc, activeIndex: number): string | null {
  const step = doc.storyRoute?.steps[activeIndex];
  return step?.blockId ?? null;
}
