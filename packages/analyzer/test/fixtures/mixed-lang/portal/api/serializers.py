def order_to_json(order):
    return {"id": order.row[0], "total": order.row[1]}
