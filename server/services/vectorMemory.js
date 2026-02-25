/**
 * server/services/vectorMemory.js — Phase 14.0: Vector Memory with HNSW
 *
 * Pure-JS HNSW (Hierarchical Navigable Small World) index for semantic
 * similarity search. Stores embeddings alongside agent memories, patterns,
 * and knowledge entries. Enables semantic recall: "find tasks similar to this"
 * to inform decomposition and escalation.
 *
 * Embedding strategy: lightweight TF-IDF over trigrams — no external APIs,
 * no heavy ML libs. Good enough for code-pattern matching; can be upgraded
 * to real embeddings (OpenAI, ONNX) later via the embed() interface.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

// ─── Trigram-based Embedding ──────────────────────────────────────────
// Dimensions = hash buckets.  128 dims keeps it fast + compact.
const EMBED_DIMS = 128;

/**
 * Compute a lightweight embedding vector from text.
 * Uses character trigram frequency hashing (locale-insensitive).
 * @param {string} text
 * @returns {Float32Array}
 */
export function embed(text) {
  const vec = new Float32Array(EMBED_DIMS);
  if (!text) return vec;
  const lower = text.toLowerCase().replace(/[^a-z0-9 ]/g, ' ');
  const tokens = lower.split(/\s+/).filter(Boolean);

  // unigram + bigram + trigram hashing
  for (const token of tokens) {
    for (let n = 1; n <= 3; n++) {
      for (let i = 0; i <= token.length - n; i++) {
        const gram = token.slice(i, i + n);
        const h = fnv1a(gram) % EMBED_DIMS;
        vec[h] += 1;
      }
    }
  }

  // L2 normalize
  let norm = 0;
  for (let i = 0; i < EMBED_DIMS; i++) norm += vec[i] * vec[i];
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < EMBED_DIMS; i++) vec[i] /= norm;

  return vec;
}

/** FNV-1a hash for short strings → deterministic uint32 */
function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = (h * 0x01000193) >>> 0;
  }
  return h;
}

// ─── Cosine Similarity ───────────────────────────────────────────────
/**
 * Cosine similarity between two vectors.
 * @param {Float32Array} a
 * @param {Float32Array} b
 * @returns {number} similarity ∈ [-1, 1]
 */
export function cosineSimilarity(a, b) {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

// ─── HNSW Index ──────────────────────────────────────────────────────
/**
 * Pure-JS HNSW index.  Good for up to ~50K entries (plenty for per-project use).
 *
 * Graph structure: each node has connections at multiple levels.
 * Search: greedy beam search from entry point, layer by layer.
 */
export class HNSWIndex {
  /**
   * @param {object} opts
   * @param {number} [opts.M=16] — max connections per node per layer
   * @param {number} [opts.efConstruction=200] — beam width during insert
   * @param {number} [opts.efSearch=50] — beam width during search
   */
  constructor(opts = {}) {
    this.M = opts.M || 16;
    this.efConstruction = opts.efConstruction || 200;
    this.efSearch = opts.efSearch || 50;
    this.maxLevel = 0;
    this.entryPoint = -1;
    /** @type {Array<{ id: string, vector: Float32Array, data: any, connections: Array<number[]> }>} */
    this.nodes = [];
    this.idToIndex = new Map();
    this.mL = 1 / Math.log(this.M);
  }

  get size() { return this.nodes.length; }

  /** Random level assignment (exponential distribution). */
  _randomLevel() {
    let level = 0;
    while (Math.random() < 0.5 && level < 16) level++;
    return level;
  }

  /**
   * Insert a vector with associated data.
   * @param {string} id — unique identifier
   * @param {Float32Array} vector
   * @param {any} data — metadata stored alongside
   */
  insert(id, vector, data = null) {
    if (this.idToIndex.has(id)) {
      // Update existing: replace vector & data, keep connections
      const idx = this.idToIndex.get(id);
      this.nodes[idx].vector = vector;
      this.nodes[idx].data = data;
      return;
    }

    const nodeLevel = this._randomLevel();
    const idx = this.nodes.length;
    const connections = [];
    for (let l = 0; l <= nodeLevel; l++) connections.push([]);

    this.nodes.push({ id, vector, data, connections });
    this.idToIndex.set(id, idx);

    if (this.entryPoint === -1) {
      this.entryPoint = idx;
      this.maxLevel = nodeLevel;
      return;
    }

    let currentNode = this.entryPoint;

    // Traverse from top level down to nodeLevel + 1 (greedy search)
    for (let level = this.maxLevel; level > nodeLevel; level--) {
      currentNode = this._greedyClosest(vector, currentNode, level);
    }

    // Insert at each level from nodeLevel down to 0
    for (let level = Math.min(nodeLevel, this.maxLevel); level >= 0; level--) {
      const neighbors = this._searchLayer(vector, currentNode, this.efConstruction, level);
      // Select M closest neighbors
      const selected = neighbors.slice(0, this.M);

      this.nodes[idx].connections[level] = selected.map(n => n.idx);

      // Add reverse connections (bidirectional graph)
      for (const neighbor of selected) {
        const nConns = this.nodes[neighbor.idx].connections[level] || [];
        nConns.push(idx);
        // Prune if over capacity
        if (nConns.length > this.M * 2) {
          // Keep closest M*2 connections
          const scored = nConns.map(c => ({
            idx: c,
            dist: 1 - cosineSimilarity(this.nodes[neighbor.idx].vector, this.nodes[c].vector)
          }));
          scored.sort((a, b) => a.dist - b.dist);
          this.nodes[neighbor.idx].connections[level] = scored.slice(0, this.M * 2).map(s => s.idx);
        } else {
          this.nodes[neighbor.idx].connections[level] = nConns;
        }
      }

      if (selected.length > 0) currentNode = selected[0].idx;
    }

    if (nodeLevel > this.maxLevel) {
      this.maxLevel = nodeLevel;
      this.entryPoint = idx;
    }
  }

  /**
   * Remove an entry by ID.
   * @param {string} id
   * @returns {boolean}
   */
  remove(id) {
    if (!this.idToIndex.has(id)) return false;
    const idx = this.idToIndex.get(id);
    // Remove from neighbor lists
    for (let level = 0; level < this.nodes[idx].connections.length; level++) {
      for (const neighborIdx of this.nodes[idx].connections[level]) {
        if (neighborIdx < this.nodes.length) {
          const nConns = this.nodes[neighborIdx].connections[level];
          if (nConns) {
            const pos = nConns.indexOf(idx);
            if (pos !== -1) nConns.splice(pos, 1);
          }
        }
      }
    }
    // Mark as deleted (don't compact to avoid index shifts)
    this.nodes[idx].vector = null;
    this.nodes[idx].data = null;
    this.nodes[idx].connections = [];
    this.idToIndex.delete(id);

    // If entry point was removed, reassign to first valid node
    if (this.entryPoint === idx) {
      this.entryPoint = -1;
      for (let i = 0; i < this.nodes.length; i++) {
        if (this.nodes[i].vector !== null) {
          this.entryPoint = i;
          break;
        }
      }
    }

    return true;
  }

  /**
   * Search for k nearest neighbors.
   * @param {Float32Array} query — query vector
   * @param {number} k — number of results
   * @param {number} [minSimilarity=0] — minimum cosine similarity threshold
   * @returns {Array<{ id: string, similarity: number, data: any }>}
   */
  search(query, k = 10, minSimilarity = 0) {
    if (this.entryPoint === -1 || this.nodes.length === 0) return [];

    let currentNode = this.entryPoint;

    // Traverse from top to level 1
    for (let level = this.maxLevel; level > 0; level--) {
      currentNode = this._greedyClosest(query, currentNode, level);
    }

    // Search at level 0 with ef candidates
    const candidates = this._searchLayer(query, currentNode, Math.max(this.efSearch, k), 0);

    return candidates
      .filter(c => c.similarity >= minSimilarity && this.nodes[c.idx].vector !== null)
      .slice(0, k)
      .map(c => ({
        id: this.nodes[c.idx].id,
        similarity: c.similarity,
        data: this.nodes[c.idx].data,
      }));
  }

  /** Greedy walk: find the single closest node at a given level. */
  _greedyClosest(query, startIdx, level) {
    let current = startIdx;
    if (this.nodes[current].vector === null) return current;
    let bestDist = 1 - cosineSimilarity(query, this.nodes[current].vector);

    let changed = true;
    while (changed) {
      changed = false;
      const conns = this.nodes[current].connections[level] || [];
      for (const neighborIdx of conns) {
        if (neighborIdx >= this.nodes.length || this.nodes[neighborIdx].vector === null) continue;
        const dist = 1 - cosineSimilarity(query, this.nodes[neighborIdx].vector);
        if (dist < bestDist) {
          bestDist = dist;
          current = neighborIdx;
          changed = true;
        }
      }
    }
    return current;
  }

  /**
   * Search a single layer with beam search.
   * Returns candidates sorted by similarity (descending).
   */
  _searchLayer(query, entryIdx, ef, level) {
    const visited = new Set([entryIdx]);
    // Handle removed entry nodes
    if (this.nodes[entryIdx].vector === null) return [];
    const sim = cosineSimilarity(query, this.nodes[entryIdx].vector);
    const candidates = [{ idx: entryIdx, similarity: sim }];
    const results = [{ idx: entryIdx, similarity: sim }];

    let ci = 0;
    while (ci < candidates.length) {
      const current = candidates[ci++];

      // If worst result is better than current candidate, stop
      if (results.length >= ef) {
        const worstResult = results[results.length - 1];
        if (current.similarity < worstResult.similarity) break;
      }

      const conns = this.nodes[current.idx].connections[level] || [];
      for (const neighborIdx of conns) {
        if (visited.has(neighborIdx)) continue;
        visited.add(neighborIdx);

        if (neighborIdx >= this.nodes.length || this.nodes[neighborIdx].vector === null) continue;

        const nSim = cosineSimilarity(query, this.nodes[neighborIdx].vector);

        if (results.length < ef || nSim > results[results.length - 1].similarity) {
          candidates.push({ idx: neighborIdx, similarity: nSim });
          results.push({ idx: neighborIdx, similarity: nSim });
          results.sort((a, b) => b.similarity - a.similarity);
          if (results.length > ef) results.length = ef;
        }
      }
    }

    // Sort candidates for ordered iteration
    candidates.sort((a, b) => b.similarity - a.similarity);
    return results;
  }

  // ─── Persistence ─────────────────────────────────────────────────
  /**
   * Serialize index to a JSON-compatible object.
   * @returns {object}
   */
  toJSON() {
    return {
      M: this.M,
      efConstruction: this.efConstruction,
      efSearch: this.efSearch,
      maxLevel: this.maxLevel,
      entryPoint: this.entryPoint,
      nodes: this.nodes.map(n => ({
        id: n.id,
        vector: n.vector ? Array.from(n.vector) : null,
        data: n.data,
        connections: n.connections,
      })),
    };
  }

  /**
   * Restore index from a serialized object.
   * @param {object} json
   * @returns {HNSWIndex}
   */
  static fromJSON(json) {
    const idx = new HNSWIndex({
      M: json.M,
      efConstruction: json.efConstruction,
      efSearch: json.efSearch,
    });
    idx.maxLevel = json.maxLevel;
    idx.entryPoint = json.entryPoint;
    idx.nodes = json.nodes.map(n => ({
      id: n.id,
      vector: n.vector ? new Float32Array(n.vector) : null,
      data: n.data,
      connections: n.connections,
    }));
    for (let i = 0; i < idx.nodes.length; i++) {
      if (idx.nodes[i].id) idx.idToIndex.set(idx.nodes[i].id, i);
    }
    return idx;
  }

  /**
   * Save index to disk.
   * @param {string} filePath
   */
  save(filePath) {
    const dir = filePath.replace(/[/\\][^/\\]+$/, '');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(filePath, JSON.stringify(this.toJSON()));
  }

  /**
   * Load index from disk.
   * @param {string} filePath
   * @returns {HNSWIndex|null}
   */
  static load(filePath) {
    if (!existsSync(filePath)) return null;
    try {
      const json = JSON.parse(readFileSync(filePath, 'utf8'));
      return HNSWIndex.fromJSON(json);
    } catch {
      return null;
    }
  }
}

// ─── Project-Scoped Vector Store ─────────────────────────────────────
// Each project gets its own HNSW index, persisted to disk.

/** @type {Map<string, HNSWIndex>} */
const projectIndices = new Map();

/**
 * Get or create the HNSW index for a project.
 * @param {string} slug — project slug
 * @param {string} [baseDir='.haivemind'] — base directory for index files
 * @returns {HNSWIndex}
 */
export function getIndex(slug, baseDir = '.haivemind') {
  if (projectIndices.has(slug)) return projectIndices.get(slug);

  const filePath = join(baseDir, 'vectors', `${slug}.hnsw.json`);
  let index = HNSWIndex.load(filePath);
  if (!index) index = new HNSWIndex();

  projectIndices.set(slug, index);
  return index;
}

/**
 * Persist a project's vector index to disk.
 * @param {string} slug
 * @param {string} [baseDir='.haivemind']
 */
export function saveIndex(slug, baseDir = '.haivemind') {
  const index = projectIndices.get(slug);
  if (!index) return;
  const filePath = join(baseDir, 'vectors', `${slug}.hnsw.json`);
  index.save(filePath);
}

/**
 * Store text with its embedding in the project's vector index.
 * @param {string} slug — project slug
 * @param {string} id — unique entry ID
 * @param {string} text — text to embed and store
 * @param {object} [metadata] — additional data stored alongside
 */
export function storeVector(slug, id, text, metadata = {}) {
  const index = getIndex(slug);
  const vector = embed(text);
  index.insert(id, vector, { text, ...metadata });
}

/**
 * Semantic search across a project's vector memory.
 * @param {string} slug — project slug
 * @param {string} query — natural language query
 * @param {number} [k=10] — number of results
 * @param {number} [minSimilarity=0.1] — minimum similarity threshold
 * @returns {Array<{ id: string, similarity: number, data: any }>}
 */
export function searchVectors(slug, query, k = 10, minSimilarity = 0.1) {
  const index = getIndex(slug);
  const queryVec = embed(query);
  return index.search(queryVec, k, minSimilarity);
}

/**
 * Remove an entry from the vector index.
 * @param {string} slug
 * @param {string} id
 * @returns {boolean}
 */
export function removeVector(slug, id) {
  const index = getIndex(slug);
  return index.remove(id);
}

/**
 * Get stats about a project's vector index.
 * @param {string} slug
 * @returns {{ size: number, maxLevel: number, dimensions: number }}
 */
export function getVectorStats(slug) {
  const index = getIndex(slug);
  return {
    size: index.size,
    maxLevel: index.maxLevel,
    dimensions: EMBED_DIMS,
  };
}
