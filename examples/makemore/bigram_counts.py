"""Step 1 of makemore: the bigram COUNTS matrix.

A bigram language model asks one question: given THIS character, how often
does EACH next character follow it in the training names?  The whole model
is a 27x27 table of counts (26 letters + the '.' boundary marker that plays
both "start of name" and "end of name").
"""

def build_counts(names):
    """Count every adjacent character pair, with '.' marking both ends."""
    chars = sorted(set(''.join(names)))
    stoi = {s: i + 1 for i, s in enumerate(chars)}
    stoi['.'] = 0
    itos = {i: s for s, i in stoi.items()}
    n = len(stoi)
    counts = [[0] * n for _ in range(n)]
    for name in names:
        seq = ['.'] + list(name) + ['.']
        for ch1, ch2 in zip(seq, seq[1:]):
            counts[stoi[ch1]][stoi[ch2]] += 1
    return counts, stoi, itos


def main():
    names = open('names.txt').read().splitlines()
    counts, stoi, itos = build_counts(names)
    # Show the row for '.': which characters START a name, and how often.
    start_row = counts[stoi['.']]
    top = sorted(range(len(start_row)), key=lambda i: -start_row[i])[:5]
    print('names:', len(names))
    print('top starting characters:', [(itos[i], start_row[i]) for i in top])


if __name__ == '__main__':
    main()
