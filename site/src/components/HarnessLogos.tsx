/**
 * Real brand marks — Simple Icons + vendored OpenAI / Pi / T3 Code.
 * Sequence uses the repo SoT mark.
 */
import { siClaudecode, siCursor, siOpencode, siWindsurf, type SimpleIcon } from 'simple-icons';
import { BrandMark } from '@/components/BrandMark';

/** Official OpenAI blossom — exact path from simple-icons@11.6.0 openai.svg */
const OPENAI: Pick<SimpleIcon, 'title' | 'hex' | 'path'> = {
  title: 'OpenAI',
  hex: '000000',
  path: 'M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z',
};

type MarkProps = { className?: string; title?: string };

function hexToCss(hex: string): string {
  const h = hex.replace(/^#/, '');
  const n = Number.parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
}

function SiMark({
  icon,
  className = '',
  title,
  color,
}: {
  icon: Pick<SimpleIcon, 'title' | 'path' | 'hex'>;
  className?: string;
  title?: string;
  color?: string;
}) {
  const label = title ?? icon.title;
  return (
    <svg
      role="img"
      viewBox="0 0 24 24"
      className={className}
      aria-label={label}
      style={color ? { color } : undefined}
    >
      <title>{label}</title>
      <path d={icon.path} fill="currentColor" />
    </svg>
  );
}

function ImgMark({
  src,
  className = '',
  title,
}: {
  src: string;
  className?: string;
  title: string;
}) {
  return (
    <img
      src={src}
      alt={title}
      title={title}
      className={`shrink-0 object-contain ${className}`}
      width={24}
      height={24}
      decoding="async"
    />
  );
}

export function CursorMark({ className = '', title }: MarkProps) {
  return (
    <SiMark icon={siCursor} className={className} title={title ?? 'Cursor'} color={hexToCss(siCursor.hex)} />
  );
}

export function ClaudeMark({ className = '', title }: MarkProps) {
  return (
    <SiMark
      icon={siClaudecode}
      className={className}
      title={title ?? 'Claude Code'}
      color={hexToCss(siClaudecode.hex)}
    />
  );
}

/** Codex — OpenAI blossom via vendored SVG (crisp at small sizes on white plates). */
export function CodexMark({ className = '', title }: MarkProps) {
  return <ImgMark src="/logos/openai.svg" className={className} title={title ?? 'Codex (OpenAI)'} />;
}

export function WindsurfMark({ className = '', title }: MarkProps) {
  return (
    <SiMark icon={siWindsurf} className={className} title={title ?? 'Windsurf'} color={hexToCss(siWindsurf.hex)} />
  );
}

/** Pi — open agent harness (pi.dev mark, vendored). */
export function PiMark({ className = '', title }: MarkProps) {
  return <ImgMark src="/logos/pi.svg" className={className} title={title ?? 'Pi'} />;
}

/** OpenCode — Simple Icons + vendored black fill. */
export function OpenCodeMark({ className = '', title }: MarkProps) {
  return (
    <SiMark
      icon={siOpencode}
      className={className}
      title={title ?? 'OpenCode'}
      color={hexToCss(siOpencode.hex)}
    />
  );
}

/** T3 Code — official prod mark from pingdotgg/t3code. */
export function T3CodeMark({ className = '', title }: MarkProps) {
  return <ImgMark src="/logos/t3code.svg" className={className} title={title ?? 'T3 Code'} />;
}

/** Always ink on light plates — never inherit studio white. */
export function SequenceHarnessMark({ className = '', title }: MarkProps) {
  return (
    <BrandMark
      className={`shrink-0 ${className}`}
      title={title ?? 'Sequence'}
      style={{ color: 'rgb(29, 29, 31)' }}
    />
  );
}

/** Closed / commercial progression: chat/IDE → Codemaps → Sequence. */
export const HARNESS_BRANDS = [
  { id: 'cursor', name: 'Cursor', Mark: CursorMark, css: hexToCss(siCursor.hex) },
  { id: 'claude', name: 'Claude Code', Mark: ClaudeMark, css: hexToCss(siClaudecode.hex) },
  { id: 'codex', name: 'Codex', Mark: CodexMark, css: hexToCss(OPENAI.hex) },
  { id: 'windsurf', name: 'Windsurf', Mark: WindsurfMark, css: hexToCss(siWindsurf.hex) },
  { id: 'sequence', name: 'Sequence', Mark: SequenceHarnessMark, css: 'var(--accent)' },
] as const;

/**
 * Model-agnostic open harnesses the owner named.
 * Sequence is the architecture-grounded workbench — not a Pi/T3 clone.
 */
export const OPEN_HARNESS_BRANDS = [
  { id: 'pi', name: 'Pi', Mark: PiMark, css: 'rgb(17, 17, 17)', blurb: 'Minimal open agent harness' },
  { id: 'opencode', name: 'OpenCode', Mark: OpenCodeMark, css: hexToCss(siOpencode.hex), blurb: 'Open chat-first agent' },
  { id: 't3', name: 'T3 Code', Mark: T3CodeMark, css: 'rgb(0, 0, 0)', blurb: 'Open multi-provider control plane' },
  { id: 'sequence', name: 'Sequence', Mark: SequenceHarnessMark, css: 'var(--accent)', blurb: 'Grounded architecture workbench' },
] as const;

export const HARNESS_COLORS = {
  cursor: 'rgb(0, 0, 0)',
  claude: 'rgb(217, 119, 87)',
  codex: 'rgb(16, 163, 127)',
  windsurf: 'rgb(11, 16, 15)',
  pi: 'rgb(17, 17, 17)',
  opencode: 'rgb(0, 0, 0)',
  t3: 'rgb(90, 90, 98)',
  sequence: 'rgb(var(--accent-dark-rgb))',
} as const;
