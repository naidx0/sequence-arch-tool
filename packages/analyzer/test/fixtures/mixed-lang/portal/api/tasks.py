from .models import Order


def nightly_totals() -> int:
    return sum(o.row[1] for o in Order.all())
