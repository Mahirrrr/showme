import json
import secrets
from .config import ROOT

CATALOG = json.loads((ROOT / 'shared/tests.json').read_text())


def build_challenges(doc):
    if doc.get('test_specs'):  # contract v4: tests stored as full objects
        specs = doc['test_specs']
    else:  # v3 documents: look the IDs up in shared/tests.json
        catalog = {t['id']: t for t in CATALOG[doc['category']]}
        specs = [catalog[t] for t in doc['tests']]
    checks = [dict(kind='buyer', prompt=t['prompt'], expect=t['expect']) for t in specs]
    if doc.get('custom_test'):
        checks.append(dict(kind='custom', prompt=doc['custom_test'], expect=doc['custom_test']))
    return [dict(id=secrets.token_urlsafe(12), **c) for c in checks]
