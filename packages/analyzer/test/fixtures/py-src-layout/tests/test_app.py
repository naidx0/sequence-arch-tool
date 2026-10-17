from mylib import Thing
from mylib.app import run


def test_run():
    assert run() and Thing
