"""Working days with Friday and Saturday off, as in the template."""

from datetime import date, timedelta

WEEKEND = (4, 5)  # Friday, Saturday (Monday = 0)


def working_days(start: date | None, finish: date | None) -> int | None:
    if not start or not finish or finish < start:
        return None
    days = (finish - start).days + 1
    full_weeks, rest = divmod(days, 7)
    count = full_weeks * 5
    for i in range(rest):
        if (start + timedelta(days=full_weeks * 7 + i)).weekday() not in WEEKEND:
            count += 1
    return count
