"""Additive score snapshots; existing inspection documents need no migration."""
from decimal import Decimal

SCORE_FIELDS = ('overall_verdict', 'pass_percentage', 'passed_tests',
                'total_selected_tests', 'passing_threshold_percent')


def scored_summary(doc, threshold):
    summary = dict(doc['summary'])
    if all(field in summary for field in SCORE_FIELDS):
        return summary  # A completed report keeps the threshold used at finish.
    total = len(doc.get('test_specs') or doc.get('tests') or [])
    final = {}
    for index, row in enumerate(doc.get('results', [])):
        if row['kind'] != 'buyer':
            continue
        identity = row.get('challenge_id') or row.get('prompt') or f'legacy_{index}'
        previous = final.get(identity)
        if previous is None or row.get('attempts', 0) >= previous.get('attempts', 0):
            final[identity] = row
    passed = min(total, sum(row['result'] == 'passed' for row in final.values()))
    # Compare the exact ratio, not a rounded display percentage.
    meets_threshold = total > 0 and Decimal(passed * 100) >= Decimal(str(threshold)) * total
    summary.update(
        passed_tests=passed, total_selected_tests=total,
        pass_percentage=passed * 100 / total if total else 0.0,
        passing_threshold_percent=threshold,
        overall_verdict='passed' if meets_threshold else 'failed',
    )
    return summary
