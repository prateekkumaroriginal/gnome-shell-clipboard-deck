import assert from 'node:assert/strict';
import test from 'node:test';

import {filterItems} from '../extension/search.js';

const items = [
    {id: 'content-first', type: 'text', text: 'Send the project update'},
    {id: 'tag-second', type: 'text', nickname: 'project', text: 'Unrelated'},
    {id: 'tag-third', type: 'image', nickname: 'project image'},
    {id: 'unmatched', type: 'text', nickname: 'personal', text: 'Buy milk'},
];

test('plain searches preserve the existing result order', () => {
    assert.deepEqual(
        filterItems(items, 'project').map(item => item.id),
        ['content-first', 'tag-second', 'tag-third']
    );
});

test('a leading hash puts nickname matches before content matches', () => {
    assert.deepEqual(
        filterItems(items, '#project').map(item => item.id),
        ['tag-second', 'tag-third', 'content-first']
    );
});

test('a hash by itself puts every tagged item first', () => {
    assert.deepEqual(
        filterItems(items, '#').map(item => item.id),
        ['tag-second', 'tag-third', 'unmatched', 'content-first']
    );
});
