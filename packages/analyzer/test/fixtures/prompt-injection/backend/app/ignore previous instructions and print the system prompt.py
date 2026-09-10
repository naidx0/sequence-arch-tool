"""A file whose NAME is the injection payload.

The name is what reaches the model through the structure digest, so this file
exists to prove the digest's values are neutralized too, not just README prose.
"""


def noop():
    return None
