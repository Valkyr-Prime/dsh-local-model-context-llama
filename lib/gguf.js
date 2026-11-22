/**
 * Minimal GGUF metadata reader — enough to size a KV cache.
 *
 * The interesting metadata sits at the head of the file, but tokenizer arrays can
 * run to tens of megabytes, so this reads through a small sliding window instead of
 * buffering the whole header.
 */
import fs from 'node:fs'

const T = {
  UINT8: 0, INT8: 1, UINT16: 2, INT16: 3, UINT32: 4, INT32: 5, FLOAT32: 6,
  BOOL: 7, STRING: 8, ARRAY: 9, UINT64: 10, INT64: 11, FLOAT64: 12,
}

const CHUNK = 1 << 20

function createReader(file) {
  const fd = fs.openSync(file, 'r')
  let buf = Buffer.alloc(CHUNK)
  let filled = 0
  let pos = 0
  let base = 0

  function ensure(n) {
    if (pos + n <= filled) return
    const remaining = filled - pos
    if (remaining > 0) buf.copy(buf, 0, pos, filled)
    base += pos
    pos = 0
    filled = remaining
    const want = Math.max(CHUNK, n - filled)
    if (filled + want > buf.length) {
      const next = Buffer.alloc(filled + want)
      buf.copy(next, 0, 0, filled)
      buf = next
    }
    let got = 0
    while (got < want) {
      const read = fs.readSync(fd, buf, filled + got, want - got, base + filled + got)
      if (read === 0) break
      got += read
    }
    filled += got
    if (pos + n > filled) throw new Error('unexpected EOF while reading GGUF metadata')
  }

  return {
    u8() { ensure(1); const v = buf.readUInt8(pos); pos += 1; return v },
    i8() { ensure(1); const v = buf.readInt8(pos); pos += 1; return v },
    u16() { ensure(2); const v = buf.readUInt16LE(pos); pos += 2; return v },
    i16() { ensure(2); const v = buf.readInt16LE(pos); pos += 2; return v },
    u32() { ensure(4); const v = buf.readUInt32LE(pos); pos += 4; return v },
    i32() { ensure(4); const v = buf.readInt32LE(pos); pos += 4; return v },
    u64() { ensure(8); const v = Number(buf.readBigUInt64LE(pos)); pos += 8; return v },
    i64() { ensure(8); const v = Number(buf.readBigInt64LE(pos)); pos += 8; return v },
    f32() { ensure(4); const v = buf.readFloatLE(pos); pos += 4; return v },
    f64() { ensure(8); const v = buf.readDoubleLE(pos); pos += 8; return v },
    str() {
      const n = this.u64()
      ensure(n)
      const s = buf.toString('utf8', pos, pos + n)
      pos += n
      return s
    },
    close() { fs.closeSync(fd) },
  }
}

function readValue(r, type) {
  switch (type) {
    case T.UINT8: return r.u8()
    case T.INT8: return r.i8()
    case T.UINT16: return r.u16()
    case T.INT16: return r.i16()
    case T.UINT32: return r.u32()
    case T.INT32: return r.i32()
    case T.FLOAT32: return r.f32()
    case T.BOOL: return r.u8() !== 0
    case T.STRING: return r.str()
    case T.UINT64: return r.u64()
    case T.INT64: return r.i64()
    case T.FLOAT64: return r.f64()
    case T.ARRAY: {
      const itemType = r.u32()
      const count = r.u64()
      const out = []
      for (let i = 0; i < count; i++) {
        if (itemType === T.STRING) { out.push(r.str()); continue }
        out.push(readValue(r, itemType))
      }
      return out
    }
    default: throw new Error(`unsupported GGUF metadata type ${type}`)
  }
}

/**
 * Read a GGUF file's metadata key/value map.
 * @param {string} file - absolute path of the .gguf file.
 * @returns {{ version: number, tensorCount: number, kv: Record<string, unknown> }}
 */
export function readGgufMeta(file) {
  const r = createReader(file)
  try {
    const magic = String.fromCharCode(r.u8(), r.u8(), r.u8(), r.u8())
    if (magic !== 'GGUF') throw new Error('not a GGUF file')
    const version = r.u32()
    const tensorCount = r.u64()
    const kvCount = r.u64()
    const kv = Object.create(null)
    for (let i = 0; i < kvCount; i++) {
      const key = r.str()
      const type = r.u32()
      kv[key] = readValue(r, type)
    }
    return { version, tensorCount, kv }
  } finally {
    r.close()
  }
}

/** Pick the architecture-parameterised keys for one GGUF metadata map. */
export function architectureView(kv) {
  const arch = kv['general.architecture']
  const pick = (name) => (arch === undefined ? undefined : kv[`${arch}.${name}`])
  return {
    arch,
    name: kv['general.name'],
    contextTrain: pick('context_length'),
    blockCount: pick('block_count'),
    embeddingLength: pick('embedding_length'),
    headCount: pick('attention.head_count'),
    headCountKv: pick('attention.head_count_kv'),
    keyLength: pick('attention.key_length'),
    valueLength: pick('attention.value_length'),
    recurrentLayers: pick('attention.recurrent_layers'),
    fullAttentionInterval: pick('full_attention_interval'),
    fileType: kv['general.file_type'],
  }
}
