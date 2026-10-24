import Database from 'better-sqlite3';
import { config } from './config.js';

export const db = new Database(config.dbPath);
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS exams (
  id INTEGER PRIMARY KEY, code TEXT UNIQUE, title TEXT, duration_min INTEGER,
  status TEXT DEFAULT 'running', created_at TEXT DEFAULT CURRENT_TIMESTAMP, summary TEXT
);
CREATE TABLE IF NOT EXISTS students (
  id INTEGER PRIMARY KEY, exam_id INTEGER, name TEXT, joined_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS frames (
  id INTEGER PRIMARY KEY, student_id INTEGER, ts TEXT DEFAULT CURRENT_TIMESTAMP, hash TEXT, path TEXT
);
CREATE INDEX IF NOT EXISTS frames_hash ON frames(hash);
CREATE TABLE IF NOT EXISTS results (
  id INTEGER PRIMARY KEY, frame_id INTEGER, stage TEXT, model TEXT, category TEXT,
  suspicious INTEGER, confidence REAL, reason TEXT, latency_ms INTEGER, source TEXT,
  is_final INTEGER DEFAULT 0, severity TEXT
);
CREATE TABLE IF NOT EXISTS flags (
  id INTEGER PRIMARY KEY, student_id INTEGER, frame_id INTEGER, result_id INTEGER,
  severity TEXT, status TEXT DEFAULT 'pending',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP, reviewed_at TEXT
);
`);

const FLAG_SELECT = `SELECT fl.*, s.name AS student_name, s.exam_id, f.path, f.ts,
  r.category, r.reason, r.confidence, r.model, r.latency_ms, r.source
  FROM flags fl JOIN students s ON s.id = fl.student_id
  JOIN frames f ON f.id = fl.frame_id JOIN results r ON r.id = fl.result_id`;

export const q = {
  createExam: db.prepare('INSERT INTO exams (code, title, duration_min) VALUES (?, ?, ?)'),
  examById: db.prepare('SELECT * FROM exams WHERE id = ?'),
  examByCode: db.prepare('SELECT * FROM exams WHERE code = ?'),
  setExamStatus: db.prepare('UPDATE exams SET status = ? WHERE id = ?'),
  setExamSummary: db.prepare('UPDATE exams SET summary = ? WHERE id = ?'),

  createStudent: db.prepare('INSERT INTO students (exam_id, name) VALUES (?, ?)'),
  studentById: db.prepare('SELECT * FROM students WHERE id = ?'),
  studentsByExam: db.prepare('SELECT * FROM students WHERE exam_id = ?'),

  createFrame: db.prepare('INSERT INTO frames (student_id, hash, path) VALUES (?, ?, ?)'),
  createResult: db.prepare(`INSERT INTO results
    (frame_id, stage, model, category, suspicious, confidence, reason, latency_ms, source, is_final, severity)
    VALUES (@frame_id, @stage, @model, @category, @suspicious, @confidence, @reason, @latency_ms, @source, @is_final, @severity)`),
  // Reuse only real model output: the final live result of an identical frame.
  cachedResult: db.prepare(`SELECT r.* FROM results r JOIN frames f ON f.id = r.frame_id
    WHERE f.hash = ? AND r.is_final = 1 AND r.source = 'live' AND r.category != 'unclear'
    ORDER BY r.id DESC LIMIT 1`),
  resultsByExam: db.prepare(`SELECT r.*, f.student_id, f.path, f.ts FROM results r
    JOIN frames f ON f.id = r.frame_id JOIN students s ON s.id = f.student_id
    WHERE s.exam_id = ? AND r.is_final = 1 ORDER BY r.id DESC LIMIT ?`),

  createFlag: db.prepare('INSERT INTO flags (student_id, frame_id, result_id, severity) VALUES (?, ?, ?, ?)'),
  setFlagStatus: db.prepare('UPDATE flags SET status = ?, reviewed_at = CURRENT_TIMESTAMP WHERE id = ?'),
  flagById: db.prepare(`${FLAG_SELECT} WHERE fl.id = ?`),
  flagsByExam: db.prepare(`${FLAG_SELECT} WHERE s.exam_id = ? ORDER BY fl.id DESC`),
};
