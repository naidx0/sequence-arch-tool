/**
 * WHAT THIS SCAN COULD NOT FOLLOW.
 *
 * `LANG_BY_EXT` covers TypeScript, JavaScript, Python, Go and Java. Every other
 * source file is `continue`d during the walk — silently. A repository whose
 * payment service is C# produces a graph with no payment service in it, and
 * nothing anywhere says why. The graph does not look wrong; it looks like a
 * system that has no payment service.
 *
 * That is the failure CANON calls worse than no tool, one level up from a false
 * edge: not a wrong claim but a confident silence. "Grounded, not guessed" is
 * about the edges we draw; this is about the ones we cannot see, and a tool
 * that will not say which is asking to be trusted about a picture it knows is
 * partial.
 *
 * IT NAMES A LANGUAGE, NOT AN EXTENSION. "42 files I could not read" sends a
 * reader looking; "42 C# files, in the payment service" tells them what the
 * missing half of their architecture is written in and where it lives.
 *
 * IT IS A COUNT, NOT A FILE LIST. The point is the shape of the gap — how much,
 * in what language, whose — and a thousand paths would bury it.
 */

/** One language the scanner cannot parse, and how much of this repo is in it. */
export interface UnfollowedSource {
  /** Human name — `C#`, `Ruby`. What a reader recognises. */
  language: string;
  /** The extensions counted under it, sorted. */
  extensions: string[];
  /** How many files were skipped. */
  files: number;
  /** The services they sit in, when the walk knew one. Sorted, deduplicated. */
  services: string[];
}

/**
 * Extensions worth reporting, and the language each belongs to.
 *
 * SOURCE ONLY, deliberately. A repo is full of `.md`, `.json`, `.svg` and
 * `.lock` files that no scanner should claim to be missing — reporting them
 * would bury the one line that matters under a hundred that do not. What earns
 * a place here is a language something could be IMPLEMENTED in, because that is
 * what makes its absence a hole in the architecture rather than in the docs.
 */
const LANGUAGE_BY_EXT: Readonly<Record<string, string>> = {
  '.cs': 'C#',
  '.fs': 'F#',
  '.vb': 'Visual Basic',
  '.rb': 'Ruby',
  '.php': 'PHP',
  '.rs': 'Rust',
  '.kt': 'Kotlin',
  '.kts': 'Kotlin',
  '.swift': 'Swift',
  '.scala': 'Scala',
  '.c': 'C',
  '.h': 'C',
  '.cc': 'C++',
  '.cpp': 'C++',
  '.hpp': 'C++',
  '.m': 'Objective-C',
  '.mm': 'Objective-C',
  '.ex': 'Elixir',
  '.exs': 'Elixir',
  '.erl': 'Erlang',
  '.dart': 'Dart',
  '.clj': 'Clojure',
  '.hs': 'Haskell',
  '.lua': 'Lua',
  '.pl': 'Perl',
  '.r': 'R',
  '.jl': 'Julia',
  '.zig': 'Zig',
};

/** The language for an extension, or null when it is not source we would want. */
export function unfollowedLanguageOf(ext: string): string | null {
  return LANGUAGE_BY_EXT[ext.toLowerCase()] ?? null;
}

/**
 * Accumulates skipped files during a walk.
 *
 * A tally rather than a list, kept per language, so the report is the same size
 * on a repo with forty C# files as on one with forty thousand.
 */
export class UnfollowedTally {
  private readonly byLanguage = new Map<
    string,
    { extensions: Set<string>; files: number; services: Set<string> }
  >();

  /** Record one skipped file. `service` is optional — the walk may not know one. */
  add(ext: string, service?: string): void {
    const language = unfollowedLanguageOf(ext);
    if (language === null) return;
    let row = this.byLanguage.get(language);
    if (!row) {
      row = { extensions: new Set(), files: 0, services: new Set() };
      this.byLanguage.set(language, row);
    }
    row.extensions.add(ext.toLowerCase());
    row.files += 1;
    if (service) row.services.add(service);
  }

  /**
   * The report, or an empty array.
   *
   * Sorted by file count descending — the biggest hole first, because that is
   * the one that decides whether the picture on screen can be trusted — then by
   * name, so two languages with the same count do not swap places between
   * scans.
   */
  report(): UnfollowedSource[] {
    return [...this.byLanguage.entries()]
      .map(([language, row]) => ({
        language,
        extensions: [...row.extensions].sort(),
        files: row.files,
        services: [...row.services].sort(),
      }))
      .sort((a, b) => b.files - a.files || a.language.localeCompare(b.language));
  }
}

/**
 * One sentence a surface can print, or null when there is nothing to say.
 *
 * Null rather than "nothing was skipped": a reassurance printed on every scan
 * of every pure-TypeScript repo is noise, and noise is what makes the one time
 * it matters easy to miss.
 */
export function unfollowedSentence(report: readonly UnfollowedSource[]): string | null {
  if (report.length === 0) return null;
  const parts = report.map((u) => {
    const where = u.services.length > 0 ? ` in ${u.services.join(', ')}` : '';
    return `${u.files} ${u.language} file${u.files === 1 ? '' : 's'}${where}`;
  });
  return (
    `This scan could not read ${parts.join('; ')}. ` +
    `Anything those files call, serve or store is missing from this graph — not absent from the system.`
  );
}
