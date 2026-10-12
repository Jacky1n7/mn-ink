// Storage layer (addon/src/30-store.js) against a fake MarginNote database.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';

const src = fs.readFileSync(new URL('../addon/src/30-store.js', import.meta.url), 'utf8');

function makeWorld() {
  let seq = 0;
  const notes = {};
  const books = {};
  const undo = [];
  function mkNote(topicId, { hidden = false, comments = [] } = {}) {
    const id = 'N' + ++seq;
    const n = {
      noteId: id, notebookId: topicId, hidden, docMd5: 'md5-' + topicId,
      comments: comments.map((t) => ({ type: 'TextNote', text: t })),
      appendTextComment(t) { this.comments.push({ type: 'TextNote', text: t }); },
      removeCommentByIndex(i) { this.comments.splice(i, 1); }
    };
    notes[id] = n;
    books[topicId].notes.push(n);
    return n;
  }
  function addBook(topicId) {
    books[topicId] = { topicId, title: topicId, notes: [] };
  }
  const ctx = {
    JSON, Math, Date, Object, String, Error,
    INK_STORE: null,
    inkApp: () => ({ documentPath: '/tmp/none' }),
    inkLog: () => {},
    NSUserDefaults: { standardUserDefaults: () => ({ objectForKey: (k) => ctx.__defaults[k], setObjectForKey: (v, k) => { ctx.__defaults[k] = v; } }) },
    __defaults: {},
    NSFileManager: { defaultManager: () => ({ fileExistsAtPath: () => false }) },
    UndoManager: { sharedInstance: () => ({ undoGrouping: (name, topic, fn) => { undo.push(name); fn(); } }) },
    Database: {
      sharedInstance: () => ({
        getNoteById: (id) => notes[id] || null,
        getNotebookById: (t) => books[t] || null,
        allNotebooks: () => Object.values(books),
        cloneNotesToTopic: (list, topicId) => list.map((src) => {
          const c = mkNote(topicId, { hidden: src.hidden, comments: src.comments.map((x) => x.text) });
          return c.noteId;
        }),
        deleteBookNote: (id) => {
          const n = notes[id];
          delete notes[id];
          books[n.notebookId].notes = books[n.notebookId].notes.filter((x) => x !== n);
        },
        setNotebookSyncDirty: () => {}
      })
    }
  };
  vm.createContext(ctx);
  vm.runInContext(src, ctx);
  return { ctx, notes, books, mkNote, addBook, undo };
}

const stroke = (id, a) => ({ id, tool: 'pen', color: '#000000', w: 2, k: 1, pts: [0, 0, 0.5, 1, 1, 0.5], a });

test('creates a hidden storage note by cloning, header anywhere, all groups read back', () => {
  const w = makeWorld();
  w.addBook('T');
  w.mkNote('T', { hidden: true, comments: ['an AI chat'] });
  const note = w.ctx.inkCreateStorageNote('T');
  assert.ok(note && note.hidden);
  assert.equal(note.comments.length, 1);
  assert.ok(w.ctx.inkIsStorageNote(note));
  // a data comment *before* the header must still be read
  note.comments.unshift({ type: 'TextNote', text: 'mnink:v1:CARD\n' + JSON.stringify({ strokes: [stroke('s1')] }) });
  note.appendTextComment('mnink:v1:_\n' + JSON.stringify({ strokes: [stroke('s2')] }));
  const strokes = w.ctx.inkParseGroups(note);
  assert.equal(JSON.stringify(strokes.map((s) => [s.id, s.a])), JSON.stringify([['s1', 'CARD'], ['s2', null]]));
});

test('commit replaces only dirty groups, in one undo step', () => {
  const w = makeWorld();
  w.addBook('T');
  w.mkNote('T', { hidden: true });
  const note = w.ctx.inkCreateStorageNote('T');
  w.ctx.INK_STORE = { topicId: 'T', noteId: note.noteId, strokes: [stroke('a', 'C1'), stroke('b', 'C2')], byId: {}, dirty: { C1: true, C2: true }, file: false, sig: '' };
  vm.runInContext('inkCommit("书写")', w.ctx);
  assert.equal(note.comments.length, 3);
  w.ctx.INK_STORE.strokes.push(stroke('c', 'C1'));
  w.ctx.INK_STORE.dirty = { C1: true };
  const before = w.undo.length;
  vm.runInContext('inkCommit("书写")', w.ctx);
  assert.equal(w.undo.length, before + 1);
  const back = w.ctx.inkParseGroups(note);
  assert.equal(back.map((s) => s.id).sort().join(), 'a,b,c');
  assert.equal(note.comments.length, 3);
});

test('a deleted storage note is rebuilt with every group, not just the dirty one', () => {
  const w = makeWorld();
  w.addBook('T');
  w.mkNote('T', { hidden: true });
  const note = w.ctx.inkCreateStorageNote('T');
  w.ctx.INK_STORE = { topicId: 'T', noteId: note.noteId, strokes: [stroke('a', 'C1'), stroke('b', 'C2')], byId: {}, dirty: { C1: true, C2: true }, file: false, sig: '' };
  vm.runInContext('inkCommit()', w.ctx);
  Database_delete(w, note.noteId);
  w.ctx.INK_STORE.strokes.push(stroke('c', 'C1'));
  w.ctx.INK_STORE.dirty = { C1: true };
  vm.runInContext('inkCommit()', w.ctx);
  const fresh = w.notes[w.ctx.INK_STORE.noteId];
  assert.ok(fresh && fresh.noteId !== note.noteId);
  assert.equal(w.ctx.inkParseGroups(fresh).map((s) => s.id).sort().join(), 'a,b,c');
});

test('old terse header is upgraded in place', () => {
  const w = makeWorld();
  w.addBook('T');
  const n = w.mkNote('T', { hidden: true, comments: ['mnink:store:v1 · old', 'mnink:v1:_\n{"strokes":[]}'] });
  w.ctx.inkUpgradeHeader(n, 'T');
  assert.ok(n.comments.some((c) => c.text === w.ctx.INK_HEADER_TEXT));
  assert.equal(n.comments.filter((c) => c.text.includes('mnink:store:v1')).length, 1);
});

function Database_delete(w, id) {
  w.ctx.Database.sharedInstance().deleteBookNote(id);
}
