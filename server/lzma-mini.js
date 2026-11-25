/**
 * Minimal Pure-JS LZMA1 Decoder (Zero external dependencies)
 * Decodes standard 13-byte-header LZMA1 streams used by Dukascopy `.bi5` candle & tick archives.
 * Based on the public-domain LZMA SDK specification (Igor Pavlov).
 */

const kNumTopBits = 24;
const kTopValue = 1 << kNumTopBits;
const kNumBitModelTotalBits = 11;
const kBitModelTotal = 1 << kNumBitModelTotalBits;
const kNumMoveBits = 5;

const kNumPosBitsMax = 4;
const kNumStates = 12;
const kLenNumLowBits = 3;
const kLenNumMidBits = 3;
const kLenNumHighBits = 8;
const kLenNumLowSymbols = 1 << kLenNumLowBits;
const kLenNumMidSymbols = 1 << kLenNumMidBits;
const kMatchMinLen = 2;

const kNumLenToPosStates = 4;
const kStartPosModelIndex = 4;
const kEndPosModelIndex = 14;
const kNumFullDistances = 1 << (kEndPosModelIndex >> 1);
const kNumAlignBits = 4;

class RangeDecoder {
  constructor(buf, offset) {
    this.buf = buf;
    this.pos = offset;
    this.range = 0xffffffff;
    this.code = 0;
    // Skip first byte (must be 0) and load next 4 bytes big-endian
    this.pos += 1;
    for (let i = 0; i < 4; i++) {
      this.code = ((this.code << 8) | (this.buf[this.pos++] || 0)) >>> 0;
    }
  }

  normalize() {
    if (this.range < kTopValue) {
      this.range = (this.range << 8) >>> 0;
      this.code = ((this.code << 8) | (this.buf[this.pos++] || 0)) >>> 0;
    }
  }

  decodeDirectBits(numTotalBits) {
    let result = 0;
    for (let i = numTotalBits; i > 0; i--) {
      this.range >>>= 1;
      const t = (this.code - this.range) >>> 31; // 1 if code < range, 0 if code >= range
      this.code = (this.code - (this.range & (t - 1))) >>> 0;
      result = (result << 1) | (1 - t);
      this.normalize();
    }
    return result >>> 0;
  }

  decodeBit(probs, idx) {
    const prob = probs[idx];
    const newBound = (this.range >>> kNumBitModelTotalBits) * prob;
    if (this.code < newBound) {
      this.range = newBound >>> 0;
      probs[idx] = prob + ((kBitModelTotal - prob) >>> kNumMoveBits);
      this.normalize();
      return 0;
    } else {
      this.range = (this.range - newBound) >>> 0;
      this.code = (this.code - newBound) >>> 0;
      probs[idx] = prob - (prob >>> kNumMoveBits);
      this.normalize();
      return 1;
    }
  }
}

function initProbs(len) {
  const arr = new Uint16Array(len);
  arr.fill(kBitModelTotal >>> 1);
  return arr;
}

class BitTreeDecoder {
  constructor(numBitLevels) {
    this.numBitLevels = numBitLevels;
    this.models = initProbs(1 << numBitLevels);
  }

  decode(rc) {
    let m = 1;
    for (let i = this.numBitLevels; i > 0; i--) {
      m = (m << 1) + rc.decodeBit(this.models, m);
    }
    return m - (1 << this.numBitLevels);
  }

  reverseDecode(rc) {
    let m = 1;
    let symbol = 0;
    for (let i = 0; i < this.numBitLevels; i++) {
      const bit = rc.decodeBit(this.models, m);
      m = (m << 1) + bit;
      symbol |= bit << i;
    }
    return symbol;
  }
}

function reverseDecodeArray(models, startIdx, rc, numBitLevels) {
  let m = 1;
  let symbol = 0;
  for (let i = 0; i < numBitLevels; i++) {
    const bit = rc.decodeBit(models, startIdx + m);
    m = (m << 1) + bit;
    symbol |= bit << i;
  }
  return symbol;
}

class LenDecoder {
  constructor() {
    this.choice = initProbs(2);
    this.lowCoder = Array.from({ length: 1 << kNumPosBitsMax }, () => new BitTreeDecoder(kLenNumLowBits));
    this.midCoder = Array.from({ length: 1 << kNumPosBitsMax }, () => new BitTreeDecoder(kLenNumMidBits));
    this.highCoder = new BitTreeDecoder(kLenNumHighBits);
  }

  decode(rc, posState) {
    if (rc.decodeBit(this.choice, 0) === 0) {
      return this.lowCoder[posState].decode(rc);
    }
    if (rc.decodeBit(this.choice, 1) === 0) {
      return kLenNumLowSymbols + this.midCoder[posState].decode(rc);
    }
    return kLenNumLowSymbols + kLenNumMidSymbols + this.highCoder.decode(rc);
  }
}

export function decompressLzma(input) {
  const buf = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (buf.length < 13) return new Uint8Array(0);

  // Header: [0]=props, [1..4]=dictSize LE, [5..12]=uncompressedSize LE (int64, -1 = unknown)
  let d = buf[0];
  if (d >= 9 * 5 * 5) throw new Error('Invalid LZMA properties byte');
  const lc = d % 9;
  d = Math.floor(d / 9);
  const lp = d % 5;
  const pb = Math.floor(d / 5);

  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const outLo = dv.getUint32(5, true);
  const outHi = dv.getUint32(9, true);
  const hasKnownSize = !(outLo === 0xffffffff && outHi === 0xffffffff);
  const expectedSize = hasKnownSize ? outLo + outHi * 0x100000000 : -1;

  if (expectedSize === 0) return new Uint8Array(0);
  if (hasKnownSize && expectedSize > 64 * 1024 * 1024) {
    throw new Error(`LZMA output size too large: ${expectedSize}`);
  }

  let out = new Uint8Array(hasKnownSize ? expectedSize : 65536);
  let outPos = 0;

  const ensureOut = (extra) => {
    if (outPos + extra <= out.length) return;
    const next = new Uint8Array(Math.max(out.length * 2, outPos + extra));
    next.set(out.subarray(0, outPos));
    out = next;
  };

  const rc = new RangeDecoder(buf, 13);
  const posMask = (1 << pb) - 1;
  const litPosMask = (1 << lp) - 1;
  const litProbs = initProbs(0x300 << (lc + lp));

  const isMatch = initProbs(kNumStates << kNumPosBitsMax);
  const isRep = initProbs(kNumStates);
  const isRepG0 = initProbs(kNumStates);
  const isRepG1 = initProbs(kNumStates);
  const isRepG2 = initProbs(kNumStates);
  const isRep0Long = initProbs(kNumStates << kNumPosBitsMax);

  const posSlotDecoder = Array.from({ length: kNumLenToPosStates }, () => new BitTreeDecoder(6));
  const posDecoders = initProbs(kNumFullDistances - kEndPosModelIndex);
  const posAlignDecoder = new BitTreeDecoder(kNumAlignBits);

  const lenDecoder = new LenDecoder();
  const repLenDecoder = new LenDecoder();

  let state = 0;
  let rep0 = 0;
  let rep1 = 0;
  let rep2 = 0;
  let rep3 = 0;
  let prevByte = 0;

  const updateStateLiteral = (s) => (s < 4 ? 0 : s < 10 ? s - 3 : s - 6);
  const updateStateMatch = (s) => (s < 7 ? 7 : 10);
  const updateStateRep = (s) => (s < 7 ? 8 : 11);
  const updateStateShortRep = (s) => (s < 7 ? 9 : 11);

  while (!hasKnownSize || outPos < expectedSize) {
    const posState = outPos & posMask;
    if (rc.decodeBit(isMatch, (state << kNumPosBitsMax) + posState) === 0) {
      // Literal
      const litState = (((outPos & litPosMask) << lc) + (prevByte >>> (8 - lc))) * 0x300;
      let symbol = 1;
      if (state >= 7) {
        let matchByte = outPos > rep0 ? out[outPos - rep0 - 1] : 0;
        do {
          const matchBit = (matchByte >>> 7) & 1;
          matchByte = (matchByte << 1) & 0xff;
          const bit = rc.decodeBit(litProbs, litState + ((1 + matchBit) << 8) + symbol);
          symbol = (symbol << 1) | bit;
          if (matchBit !== bit) break;
        } while (symbol < 0x100);
      }
      while (symbol < 0x100) {
        symbol = (symbol << 1) | rc.decodeBit(litProbs, litState + symbol);
      }
      const byteVal = symbol & 0xff;
      ensureOut(1);
      out[outPos++] = byteVal;
      prevByte = byteVal;
      state = updateStateLiteral(state);
    } else {
      let len;
      if (rc.decodeBit(isRep, state) === 1) {
        if (rc.decodeBit(isRepG0, state) === 0) {
          if (rc.decodeBit(isRep0Long, (state << kNumPosBitsMax) + posState) === 0) {
            state = updateStateShortRep(state);
            const byteVal = outPos > rep0 ? out[outPos - rep0 - 1] : 0;
            ensureOut(1);
            out[outPos++] = byteVal;
            prevByte = byteVal;
            continue;
          }
        } else {
          let dist;
          if (rc.decodeBit(isRepG1, state) === 0) {
            dist = rep1;
          } else {
            if (rc.decodeBit(isRepG2, state) === 0) {
              dist = rep2;
            } else {
              dist = rep3;
              rep3 = rep2;
            }
            rep2 = rep1;
          }
          rep1 = rep0;
          rep0 = dist;
        }
        len = repLenDecoder.decode(rc, posState) + kMatchMinLen;
        state = updateStateRep(state);
      } else {
        rep3 = rep2;
        rep2 = rep1;
        rep1 = rep0;
        len = lenDecoder.decode(rc, posState) + kMatchMinLen;
        state = updateStateMatch(state);
        const lenToPos = len - kMatchMinLen < kNumLenToPosStates ? len - kMatchMinLen : kNumLenToPosStates - 1;
        const posSlot = posSlotDecoder[lenToPos].decode(rc);
        if (posSlot >= kStartPosModelIndex) {
          const numDirectBits = (posSlot >>> 1) - 1;
          rep0 = (2 | (posSlot & 1)) << numDirectBits;
          if (posSlot < kEndPosModelIndex) {
            rep0 += reverseDecodeArray(posDecoders, rep0 - posSlot - 1, rc, numDirectBits);
          } else {
            rep0 += rc.decodeDirectBits(numDirectBits - kNumAlignBits) << kNumAlignBits;
            rep0 += posAlignDecoder.reverseDecode(rc);
          }
        } else {
          rep0 = posSlot;
        }
      }

      // End-of-stream marker
      if (rep0 === 0xffffffff) break;

      const dist = rep0 + 1;
      if (dist > outPos) {
        throw new Error(`Invalid LZMA back-reference distance (${dist} > ${outPos})`);
      }
      ensureOut(len);
      for (let i = 0; i < len; i++) {
        const b = out[outPos - dist];
        out[outPos++] = b;
        prevByte = b;
      }
    }
  }

  return out.subarray(0, outPos);
}
