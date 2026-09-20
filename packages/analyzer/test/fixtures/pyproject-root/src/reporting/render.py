def render_report(payload):
    return "rows=%s" % payload.get("rows", 0)
