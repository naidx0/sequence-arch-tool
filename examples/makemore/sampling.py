"""Step 2 of makemore: SAMPLING from the counts.

Turn each row of counts into a probability distribution (divide by the row
sum), then walk: start at '.', draw the next character from its row's
probabilities, move to that character's row, repeat until '.' comes out
again.  Every name this generates is plausible-by-construction: it only
ever takes steps the training data took.
"""
import random

from bigram_counts import build_counts


def row_to_probs(row):
    total = sum(row) or 1
    return [c / total for c in row]


def sample_name(counts, stoi, itos, rng):
    out = []
    ix = stoi['.']
    while True:
        probs = row_to_probs(counts[ix])
        ix = rng.choices(range(len(probs)), weights=probs)[0]
        if ix == stoi['.']:
            return ''.join(out)
        out.append(itos[ix])


def main():
    names = open('names.txt').read().splitlines()
    counts, stoi, itos = build_counts(names)
    rng = random.Random(42)
    print('sampled names:')
    for _ in range(8):
        print(' ', sample_name(counts, stoi, itos, rng))


if __name__ == '__main__':
    main()
