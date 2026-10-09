import {test} from 'node:test';
import assert from 'node:assert/strict';
import {countPlants} from './garden.mjs';
test('an empty garden has no plants',()=>assert.equal(countPlants([]),0));
test('counts the plants in a garden',()=>assert.equal(countPlants(['fern','moss']),2));
