'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');

test('memories page binds the cloud library from window before using it', () => {
  const root = path.resolve(__dirname, '..');
  const librarySource = fs.readFileSync(path.join(__dirname, 'cloud-memory-library.js'), 'utf8');
  const pageSource = fs.readFileSync(path.join(root, 'memories.html'), 'utf8');
  const inlineSource = pageSource.match(/<script>\s*([\s\S]*?)<\/script>\s*<\/body>/)?.[1] || '';
  const binding = inlineSource.match(/const MemoryLibrary = window\.MemoryLibrary;/)?.[0] || '';
  const context = vm.createContext({
    window: { CloudBaseClient: { call() {}, status() {} } },
    Intl,
    setTimeout,
    Image: function Image() {},
    FileReader: function FileReader() {},
    crypto: { randomUUID: () => 'test-id' }
  });

  vm.runInContext(librarySource, context);
  assert.ok(context.window.MemoryLibrary, 'cloud library should export window.MemoryLibrary');
  assert.ok(binding, 'memories.html must explicitly bind window.MemoryLibrary');
  vm.runInContext(`${binding}\nif (!MemoryLibrary) throw new Error('missing');`, context);
});

test('shared memories page does not open or mutate the legacy browser archive', () => {
  const root = path.resolve(__dirname, '..');
  const pageSource = fs.readFileSync(path.join(root, 'memories.html'), 'utf8');
  const cloudLibrarySource = fs.readFileSync(path.join(__dirname, 'cloud-memory-library.js'), 'utf8');

  assert.doesNotMatch(pageSource, /<script[^>]+src=["'](?:assets\/)?memory-library\.js(?:[?"'])/i);
  assert.doesNotMatch(pageSource, /\bindexedDB\b|\blocalStorage\b/);
  assert.doesNotMatch(cloudLibrarySource, /\bindexedDB\b|\blocalStorage\b/);
});
