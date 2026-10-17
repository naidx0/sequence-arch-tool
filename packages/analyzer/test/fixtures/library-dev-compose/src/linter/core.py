from linter import rules


def lint(text):
    return rules.check(text)
