"""Minimal reader for TensorFlow V2 checkpoints (the .index / .data-00000-of-00001 pair) without TensorFlow.

The .index file is a LevelDB-style table (no compression) whose keys are tensor names and whose values are
serialized BundleEntryProto messages (dtype, shape, shard, offset, size). The .data file is the raw tensor bytes.

  python3 tfckpt.py path/to/model-17900        # lists tensors
"""
import os, struct, sys
import numpy as np

DTYPES = {1: np.float32, 2: np.float64, 3: np.int32, 9: np.int64, 10: np.bool_, 4: np.uint8, 6: np.int8, 5: np.int16, 19: np.float16}

def _varint(buf, pos):
    out = 0; shift = 0
    while True:
        b = buf[pos]; pos += 1; out |= (b & 0x7f) << shift; shift += 7
        if not (b & 0x80): return out, pos

def _block_entries(block):
    """Yields (key, value) from one table block (prefix-compressed keys)."""
    n_restarts = struct.unpack('<I', block[-4:])[0]
    end = len(block) - 4 - 4 * n_restarts
    pos = 0; key = b''
    while pos < end:
        shared, pos = _varint(block, pos); unshared, pos = _varint(block, pos); vlen, pos = _varint(block, pos)
        key = key[:shared] + block[pos:pos + unshared]; pos += unshared
        value = block[pos:pos + vlen]; pos += vlen
        yield key, value

def _read_block(data, handle):
    offset, pos = _varint(handle, 0); size, pos = _varint(handle, pos)
    blk = data[offset:offset + size]  # trailer (compression byte + crc) follows and is ignored
    assert data[offset + size] == 0, 'compressed index blocks are not supported'
    return blk

def _parse_proto(buf):
    """Generic protobuf field walk → list of (field, wiretype, value)."""
    out = []; pos = 0
    while pos < len(buf):
        tag, pos = _varint(buf, pos); field, wt = tag >> 3, tag & 7
        if wt == 0: v, pos = _varint(buf, pos)
        elif wt == 1: v = struct.unpack('<Q', buf[pos:pos + 8])[0]; pos += 8
        elif wt == 2: ln, pos = _varint(buf, pos); v = buf[pos:pos + ln]; pos += ln
        elif wt == 5: v = struct.unpack('<I', buf[pos:pos + 4])[0]; pos += 4
        else: raise ValueError('unsupported wire type %d' % wt)
        out.append((field, wt, v))
    return out

def _entry(value):
    e = {'dtype': 1, 'shape': [], 'shard': 0, 'offset': 0, 'size': 0}
    for field, wt, v in _parse_proto(value):
        if field == 1: e['dtype'] = v
        elif field == 2:
            for f2, _, v2 in _parse_proto(v):
                if f2 == 2:
                    size = 0
                    for f3, _, v3 in _parse_proto(v2):
                        if f3 == 1: size = v3
                    e['shape'].append(size)
        elif field == 3: e['shard'] = v
        elif field == 4: e['offset'] = v
        elif field == 5: e['size'] = v
    return e

class Checkpoint:
    def __init__(self, prefix):
        self.prefix = prefix
        idx = open(prefix + '.index', 'rb').read()
        footer = idx[-48:]
        assert footer[-8:] == bytes.fromhex('57fb808b247547db'), 'not a leveldb table'
        meta_off, p = _varint(footer, 0); meta_sz, p = _varint(footer, p)
        index_block = _read_block(idx, footer[p:])
        self.entries = {}
        for _, handle in _block_entries(index_block):
            for key, value in _block_entries(_read_block(idx, handle)):
                if key == b'': continue  # bundle header
                self.entries[key.decode('utf-8')] = _entry(value)
        self._data = {}

    def names(self): return sorted(self.entries)

    def get(self, name):
        e = self.entries[name]
        if e['shard'] not in self._data:
            nshards = 1
            while not os.path.exists('%s.data-%05d-of-%05d' % (self.prefix, e['shard'], nshards)) and nshards < 64: nshards += 1
            self._data[e['shard']] = np.memmap('%s.data-%05d-of-%05d' % (self.prefix, e['shard'], nshards), dtype=np.uint8, mode='r')
        raw = self._data[e['shard']][e['offset']:e['offset'] + e['size']]
        return np.frombuffer(raw.tobytes(), dtype=DTYPES[e['dtype']]).reshape(e['shape'])

if __name__ == '__main__':
    ck = Checkpoint(sys.argv[1])
    for n in ck.names():
        e = ck.entries[n]; print('%-70s %-10s %s' % (n, DTYPES.get(e['dtype'], e['dtype']).__name__ if e['dtype'] in DTYPES else e['dtype'], e['shape']))
