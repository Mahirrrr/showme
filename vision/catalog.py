import json
import secrets
from .config import ROOT

CATALOG = json.loads((ROOT / 'shared/tests.json').read_text())


def build_challenges(doc):
    catalog = {t['id']: t for t in CATALOG[doc['category']]}
    checks = [dict(kind='buyer', prompt=catalog[t]['prompt'], expect=catalog[t]['expect']) for t in doc['tests']]
    if doc.get('custom_test'):
        checks.append(dict(kind='custom', prompt=doc['custom_test'], expect=doc['custom_test']))
    n = secrets.randbelow(5) + 1
    pool = [
        (f'Hold up {n} fingers next to it', f'exactly {n} fingers held up next to the item'),
        ('Turn it upside down', 'the item visibly turned upside down'),
        ('Put your flat hand on top', 'a flat hand visibly placed on top of the item'),
        ('Tap it twice', 'two visible taps on the item across the frames'),
    ]
    for prompt, expect in secrets.SystemRandom().sample(pool, secrets.randbelow(2) + 1):
        checks.append(dict(kind='liveness', prompt=prompt, expect=expect))
    secrets.SystemRandom().shuffle(checks)
    return [dict(id=secrets.token_urlsafe(12), **c) for c in checks]
