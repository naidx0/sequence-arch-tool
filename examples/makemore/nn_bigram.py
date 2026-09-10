"""Step 3 of makemore: the SAME bigram model as a one-layer neural net.

The punchline of the video's first part: a linear layer trained with
gradient descent on one-hot characters LEARNS the (log-)counts matrix.
Counting and training converge on the same table — the neural net is not
magic, it is a differentiable way to arrive at step 1.

Pure-python gradient descent on the negative log likelihood, tiny on
purpose: the shapes are the lesson, not the speed.
"""
import math
import random

from bigram_counts import build_counts


def train(names, stoi, steps=200, lr=5.0, seed=42):
    n = len(stoi)
    rng = random.Random(seed)
    W = [[rng.gauss(0, 0.1) for _ in range(n)] for _ in range(n)]
    pairs = []
    for name in names:
        seq = ['.'] + list(name) + ['.']
        pairs += [(stoi[a], stoi[b]) for a, b in zip(seq, seq[1:])]
    for step in range(steps):
        # forward: logits are just W[row] (one-hot input picks a row)
        loss = 0.0
        grad = [[0.0] * n for _ in range(n)]
        for ix, iy in pairs:
            logits = W[ix]
            m = max(logits)
            exps = [math.exp(l - m) for l in logits]
            total = sum(exps)
            probs = [e / total for e in exps]
            loss -= math.log(probs[iy])
            for j in range(n):
                grad[ix][j] += probs[j] - (1.0 if j == iy else 0.0)
        loss /= len(pairs)
        for i in range(n):
            for j in range(n):
                W[i][j] -= lr * grad[i][j] / len(pairs)
        if step % 50 == 0:
            print(f'step {step:4d}  nll {loss:.4f}')
    return W


def main():
    names = open('names.txt').read().splitlines()
    counts, stoi, itos = build_counts(names)
    W = train(names, stoi)
    # The learned row for '.' should rank starters like the counted row does.
    start = sorted(range(len(W[0])), key=lambda j: -W[stoi['.']][j])[:5]
    counted = sorted(range(len(counts[0])), key=lambda j: -counts[stoi['.']][j])[:5]
    print('nn top starters:     ', [itos[j] for j in start])
    print('counted top starters:', [itos[j] for j in counted])


if __name__ == '__main__':
    main()
