"""Detached documents and optimistic revisions prevent lost cross-worker updates."""
from copy import deepcopy
from threading import RLock
from pymongo import MongoClient
from pymongo.errors import DuplicateKeyError


class Conflict(Exception):
    pass


class MemoryStore:
    def __init__(self):
        self.docs = {}
        self.lock = RLock()

    def all(self):
        with self.lock:
            return deepcopy(list(self.docs.values()))

    def get(self, request_id):
        with self.lock:
            return deepcopy(self.docs.get(request_id))

    def insert(self, doc):
        with self.lock:
            if any(d['token'] == doc['token'] or (d.get('active_code') and d['active_code'] == doc.get('active_code')) for d in self.docs.values()):
                raise DuplicateKeyError('duplicate identifier')
            self.docs[doc['request_id']] = deepcopy(doc)

    def save(self, doc):
        with self.lock:
            old = self.docs.get(doc['request_id'])
            if old is None or old['revision'] != doc['revision']:
                raise Conflict()
            doc['revision'] += 1
            self.docs[doc['request_id']] = deepcopy(doc)

    def find_token(self, token):
        return next((d for d in self.all() if d['token'] == token), None)

    def find_waiting(self, code=None):
        docs = [d for d in self.all() if d['status'] == 'awaiting_seller' and (code is None or d['code'] == code)]
        return max(docs, key=lambda d: d['created_at']) if docs else None

    def expire_waiting(self, timestamp):
        with self.lock:
            for doc in self.docs.values():
                if doc['status'] == 'awaiting_seller' and doc['expires_at'] <= timestamp:
                    doc['status'] = 'expired'
                    doc.pop('active_code', None)
                    doc['revision'] += 1

    def close(self):
        pass


class MongoStore:
    def __init__(self, uri='', database='showme', collection=None):
        self.client = None
        if collection is None:
            self.client = MongoClient(uri, serverSelectionTimeoutMS=4000, connectTimeoutMS=4000, socketTimeoutMS=5000, tz_aware=True)
            self.client.admin.command('ping')
            collection = self.client[database]['requests']
        self.collection = collection
        collection.create_index('request_id', unique=True)
        collection.create_index('token', unique=True)
        # Reserve the code during calls as well, so abort can restore the SAME code.
        collection.create_index('active_code', unique=True, partialFilterExpression={'active_code': {'$type': 'string'}})
        collection.create_index([('code', 1), ('status', 1)])
        collection.create_index([('status', 1), ('created_at', -1)])
        collection.create_index('expires_at')  # no TTL: completed reports survive

    def all(self):
        return list(self.collection.find({}, {'_id': 0}))

    def get(self, request_id):
        return self.collection.find_one({'request_id': request_id}, {'_id': 0})

    def insert(self, doc):
        self.collection.insert_one(deepcopy(doc))

    def save(self, doc):
        revision = doc['revision']
        updated = deepcopy(doc)
        updated['revision'] += 1
        result = self.collection.replace_one({'request_id': doc['request_id'], 'revision': revision}, updated)
        if not result.matched_count:
            raise Conflict()
        doc['revision'] += 1

    def find_token(self, token):
        return self.collection.find_one({'token': token}, {'_id': 0})

    def find_waiting(self, code=None):
        query = {'status': 'awaiting_seller'}
        if code is not None:
            query['code'] = code
        return self.collection.find_one(query, {'_id': 0}, sort=[('created_at', -1), ('_id', -1)])

    def expire_waiting(self, timestamp):
        self.collection.update_many({'status': 'awaiting_seller', 'expires_at': {'$lte': timestamp}},
            {'$set': {'status': 'expired'}, '$unset': {'active_code': ''}, '$inc': {'revision': 1}})

    def close(self):
        if self.client:
            self.client.close()
