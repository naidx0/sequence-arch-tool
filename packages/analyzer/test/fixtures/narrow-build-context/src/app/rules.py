def lint(sql):
    return [] if sql.strip() else ["empty statement"]
