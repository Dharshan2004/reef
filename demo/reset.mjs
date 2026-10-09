import {writeFile} from 'node:fs/promises';
await writeFile(new URL('./bug-garden/garden.mjs',import.meta.url),'export function countPlants(plants) {\n  return plants.length || 1;\n}\n');
console.log('Demo reset. The empty-garden test intentionally fails again.');
