'use strict';

const dateApi = require('./dateApi');
const memoryApi = require('./memoryApi');

const MEMORY_ACTIONS = new Set([
  'listMemories',
  'createMemory',
  'createStandalonePhoto',
  'updateMemory',
  'addPhoto',
  'softDeletePhoto',
  'restorePhoto',
  'softDeleteMemory',
  'restoreMemory',
  'finalizePhotoDelete',
  'finalizeMemoryDelete'
]);

exports.main = (event, context) => {
  if (MEMORY_ACTIONS.has(event?.action)) return memoryApi.main(event, context);
  return dateApi.main(event, context);
};
