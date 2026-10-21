from . import typing as ft
from .helpers import clean


class Thing:
    handler: ft.Handler = object


def run():
    return clean(Thing())
