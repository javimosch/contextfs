'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/**
 * JsonStore — simple JSON flat-file persistence with atomic writes.
 * Interface is designed to be swappable with a MongoStore later:
 *   get(id), set(id, doc), delete(id), list(), load(), save()
 */
class JsonStore {
  constructor(filePath) {
    this._filePath = filePath;
    this._data = {};
    this._loaded = false;
  }

  /** Load data from disk. Call once at startup. */
  load() {
    try {
      const dir = path.dirname(this._filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      if (fs.existsSync(this._filePath)) {
        const raw = fs.readFileSync(this._filePath, 'utf8');
        this._data = JSON.parse(raw);
      } else {
        this._data = {};
      }
    } catch (err) {
      console.error(`[JsonStore] Failed to load ${this._filePath}:`, err.message);
      this._data = {};
    }
    this._loaded = true;
    return this;
  }

  /** Atomic write: write to .tmp then rename. */
  save() {
    try {
      const dir = path.dirname(this._filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const tmpPath = this._filePath + '.tmp.' + crypto.randomBytes(4).toString('hex');
      fs.writeFileSync(tmpPath, JSON.stringify(this._data, null, 2), 'utf8');
      fs.renameSync(tmpPath, this._filePath);
    } catch (err) {
      console.error(`[JsonStore] Failed to save ${this._filePath}:`, err.message);
    }
    return this;
  }

  get(id) {
    return this._data[id] || null;
  }

  set(id, doc) {
    this._data[id] = { ...doc, id };
    this.save();
    return this._data[id];
  }

  delete(id) {
    const existed = id in this._data;
    delete this._data[id];
    if (existed) this.save();
    return existed;
  }

  list() {
    return Object.values(this._data);
  }

  has(id) {
    return id in this._data;
  }

  /** Return a deep copy of internal data (for testing / inspection). */
  toObject() {
    return JSON.parse(JSON.stringify(this._data));
  }
}

module.exports = { JsonStore };
