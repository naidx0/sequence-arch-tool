/** The catalog as the agent reads it: generated from the same schemas the validator uses,
 *  so the prompt cannot drift from what is accepted (json-render's catalog.prompt()). */
import { z } from 'zod';
import { CATALOG } from './catalog.js';

function propsLine(schema: z.ZodType): string {
  try {
    const js = z.toJSONSchema(schema, { unrepresentable: 'any' }) as { properties?: Record<string, { type?: string; enum?: string[]; anyOf?: unknown[] }>; required?: string[] };
    const req = new Set(js.required ?? []);
    return Object.entries(js.properties ?? {})
      .map(([k, v]) => `${k}${req.has(k) ? '' : '?'}: ${v.enum ? v.enum.join('|') : v.type ?? (v.anyOf ? 'union' : 'object')}`)
      .join(', ');
  } catch {
    return '';
  }
}

export function catalogPrompt(): string {
  const comps = Object.entries(CATALOG).map(([name, d]) => {
    const kids = d.children === 'none' ? 'no children' : d.children === 'any' ? 'any children' : `children: ${d.children.join('|')}`;
    return `- ${name} {${propsLine(d.props)}} (${kids}). ${d.description} e.g. ${JSON.stringify(d.example)}`;
  });
  return [
    'GENERATIVE UI. To show the person live, interactive UI instead of prose, write a ```genui fence of JSONL: one op per line.',
    'Ops:',
    '  {"op":"el","id":"<id>","type":"<Component>","props":{...},"children":["<id>",...],"parent":"<id>"}  add or update one element (props merge)',
    '  {"op":"set","path":"/tests/passed","value":36}   write the data model; props bind to it with {"$state":"/tests/passed"}',
    '  {"op":"status","status":"working|done|error","label":"Running 36 of 42 tests"}',
    '  {"op":"add","path":"/actions/run_tests","value":{"description":"Run the suite"}}  declare an action before a Button uses it',
    '  {"op":"append","path":"/elements/<id>/children","value":"<id>"} | {"op":"remove","path":"/elements/<id>"}',
    'Rules: only the components below; ids are stable (update an element by its id, never re-create it); send the frame (Card, Timeline) first and fill it in;',
    'live numbers go in state and bind; tones are semantic (accent=action, success=done/open, warning=needs attention, danger=failed, merged=merged);',
    'a Button sends {name, params} back to you as a ui.action event; declare every action. If the renderer replies with ui.diagnostics, answer with only the ops that fix those paths.',
    'Components:',
    ...comps,
  ].join('\n');
}
