/* Test-only specimen: mounted production Board, annotations and agent overlay. */
import { useCallback, useReducer, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../../tokens/graphite.css';
import '../../styles/base.css';
import '../board.css';
import { Board } from '../Board';
import type { BoardNode } from '../NodeCard';
import { EMPTY_CANVAS } from '../../state/initial';
import { canvasReduce } from '../canvasReduce';
import { ArchCapture, ArchMarks, ArchPalette, type ArchTool } from './ArchDraw';
import type { Point, WbItem } from '../../whiteboard/whiteboardModel';
import { AgentLights } from '../AgentOverlay';
import { createAgentStore } from '../../agents/agentStream';
import type { AgentEvent } from '../../agents/agentTypes';

const marks: WbItem[] = [
  { kind: 'shape', id: 'rect', shape: 'rect', from: { x: 180, y: 320 }, to: { x: 300, y: 380 } },
  { kind: 'text', id: 'text', at: { x: 340, y: 340 }, text: 'Annotation evidence', by: 'agent' },
  { kind: 'text', id: 'sticky', at: { x: 500, y: 320 }, text: 'Keep this note', sticky: true },
];
const nodes: BoardNode[] = ['a', 'b', 'c'].map(id => ({ id: `svc:${id}`, label: `Service ${id}`, subtitle: null, present: { kind: 'service', entry: false }, schemaKind: 'service', provenance: 'traced', count: null }));
const store = createAgentStore(() => null);
let event = 0;
function Specimen() {
  const [canvas, dispatch] = useReducer(canvasReduce, { ...EMPTY_CANVAS, view: { state: 'S1' }, layout: 'idle' });
  const [items, setItems] = useState(marks);
  const [tool, setTool] = useState<ArchTool>('select');
  const [shown, setShown] = useState(true);
  const [empty, setEmpty] = useState(false);
  const convert = useRef<(p: Point) => Point>(p => p);
  const ready = useCallback((api: { screenToFlow: (p: Point) => Point }) => { convert.current = api.screenToFlow; }, []);
  return <>
    <div style={{ minHeight: 60, display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
      <span>Board completion specimen</span>
      {[1, .25].map(zoom => <button key={zoom} onClick={() => dispatch({ type: 'canvas/viewport', viewport: { x: 70, y: 70, zoom } })}>Zoom {zoom}</button>)}
      <button onClick={() => setShown(s => !s)}>Toggle pane</button>
      <button onClick={() => setItems(marks)}>Reset marks</button>
      <button onClick={() => setEmpty(s => !s)}>Empty board</button>
      <button onClick={() => nodes.forEach(n => store.apply({ id: `ev-${++event}`, at: Date.now(), source: 'claude-hook', sessionId: 'specimen', kind: 'tool_end', tool: 'Edit', toolKind: 'edit', status: 'done', toolUseId: `u-${event}`, title: 'Edit', paths: [`${n.id}.ts`], board: [{ path: `${n.id}.ts`, fileNodeId: null, moduleId: null, serviceId: n.id, serviceLabel: n.label, touchedEdgeIds: [], liftedEdges: [] }] } as AgentEvent))}>Agents</button>
    </div>
    <div className="board-scope board-stack" data-view={shown ? 'map' : 'hidden'} style={{ height: 560, display: shown ? 'block' : 'none' }}>
      <AgentLights store={store} delayMs={0} />
      <Board canvas={canvas} nodes={empty ? [] : nodes} edges={empty ? [] : [{ id: 'a-b', source: 'svc:a', target: 'svc:b', proof: 'traced', label: 'calls' }, { id: 'b-c', source: 'svc:b', target: 'svc:c', proof: 'traced', label: 'calls' }]} positions={{ 'svc:a': { x: 100, y: 100 }, 'svc:b': { x: 290, y: 100 }, 'svc:c': { x: 480, y: 100 } }} dispatch={dispatch} onGround={() => {}} drawing onFlowReady={ready}
        renderOverlay={({ boxOf, paths, cards }) => <ArchMarks items={empty ? [] : items} boxOf={boxOf} paths={paths} cards={cards} hittable />}
        renderDrawCapture={(passive, boxes) => <ArchCapture tool={tool === 'sketch' ? 'select' : tool} passive={passive} toFlow={p => convert.current(p)} boxes={boxes} items={items} onPut={item => setItems(old => old.map(i => i.id === item.id ? item : i))} onRemove={id => setItems(old => old.filter(i => i.id !== id))} />} />
      <ArchPalette tool={tool} onTool={setTool} onDone={() => {}} hidden={0} />
    </div>
    <output data-testid="stored-marks" style={{ display: 'none' }}>{JSON.stringify(items)}</output>
  </>;
}
createRoot(document.getElementById('root')!).render(<Specimen />);
